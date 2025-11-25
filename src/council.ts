/**
 * LLM Council
 * 
 * Orchestrates multiple moderation providers for edge case decisions.
 * Uses hybrid aggregation: unanimous = auto-decide, split = human review.
 */

import {
  ModerationProvider,
  ProviderResult,
  CouncilVote,
  CouncilResult,
  HumanReviewItem,
  HumanReviewReason,
  AuditLogEntry,
} from './providers/types';
import { createProvider, ProviderName } from './providers';
import { CategoryScores } from './types';

// =============================================================================
// COUNCIL CONFIGURATION
// =============================================================================

export interface CouncilConfig {
  /** Council member providers */
  members: ProviderName[];
  
  /** Escalation thresholds (from primary provider) */
  escalateMin: number;  // Default: 0.30
  escalateMax: number;  // Default: 0.70
  
  /** Council decision thresholds */
  unanimousAutoDecide: boolean;           // Default: true
  majorityConfidenceThreshold: number;    // Default: 0.60
  
  /** Human review settings */
  sendSplitsToHuman: boolean;             // Default: true
  sendLowConfidenceToHuman: boolean;      // Default: true
  
  /** Timeout for council members (ms) */
  memberTimeout: number;                   // Default: 30000
  
  /** Minimum council members required for decision */
  minMembers: number;                      // Default: 2
}

export const DEFAULT_COUNCIL_CONFIG: CouncilConfig = {
  members: ['anthropic', 'gemini'],
  escalateMin: 0.30,
  escalateMax: 0.70,
  unanimousAutoDecide: true,
  majorityConfidenceThreshold: 0.60,
  sendSplitsToHuman: true,
  sendLowConfidenceToHuman: true,
  memberTimeout: 30000,
  minMembers: 2,
};

// =============================================================================
// COUNCIL CLASS
// =============================================================================

export class Council {
  private config: CouncilConfig;
  private members: ModerationProvider[];
  private auditLog: AuditLogEntry[] = [];
  private humanReviewQueue: HumanReviewItem[] = [];
  
  constructor(config: Partial<CouncilConfig> = {}) {
    this.config = { ...DEFAULT_COUNCIL_CONFIG, ...config };
    this.members = this.initializeMembers();
  }
  
  private initializeMembers(): ModerationProvider[] {
    const members: ModerationProvider[] = [];
    
    for (const name of this.config.members) {
      try {
        const provider = createProvider(name);
        if (provider.isAvailable()) {
          members.push(provider);
        } else {
          console.warn(`Council member ${name} is not available (missing API key?)`);
        }
      } catch (err) {
        console.error(`Failed to initialize council member ${name}:`, err);
      }
    }
    
    if (members.length < this.config.minMembers) {
      console.warn(`Only ${members.length} council members available (minimum: ${this.config.minMembers})`);
    }
    
    return members;
  }
  
  /**
   * Check if primary result should be escalated to council
   */
  shouldEscalate(primaryResult: ProviderResult): boolean {
    const conf = primaryResult.confidence;
    return conf >= this.config.escalateMin && conf <= this.config.escalateMax;
  }
  
  /**
   * Convene the council for a decision
   */
  async convene(text: string, primaryResult: ProviderResult): Promise<CouncilResult> {
    if (this.members.length === 0) {
      // No council members, return primary result as-is
      return {
        votes: [],
        unanimous: true,
        majorityFlagged: primaryResult.flagged,
        majorityConfidence: primaryResult.confidence,
        averageConfidence: primaryResult.confidence,
        decision: primaryResult.flagged ? 'flagged' : 'clean',
        decisionReason: 'No council members available, using primary result',
      };
    }
    
    // Gather votes from all council members in parallel
    const votePromises = this.members.map(async (member): Promise<CouncilVote | null> => {
      try {
        const result = await Promise.race([
          member.analyze(text),
          this.timeout(this.config.memberTimeout),
        ]);
        
        if (!result) return null;
        
        return {
          provider: member.name,
          flagged: result.flagged,
          confidence: result.confidence,
          categories: result.categories,
          latencyMs: result.latencyMs,
        };
      } catch (err) {
        console.error(`Council member ${member.name} failed:`, err);
        return null;
      }
    });
    
    const results = await Promise.all(votePromises);
    const votes = results.filter((v): v is CouncilVote => v !== null);
    
    if (votes.length === 0) {
      // All members failed, use primary result
      return {
        votes: [],
        unanimous: true,
        majorityFlagged: primaryResult.flagged,
        majorityConfidence: primaryResult.confidence,
        averageConfidence: primaryResult.confidence,
        decision: primaryResult.flagged ? 'flagged' : 'clean',
        decisionReason: 'All council members failed, using primary result',
      };
    }
    
    // Aggregate votes
    return this.aggregateVotes(votes);
  }
  
  /**
   * Aggregate council votes using hybrid decision flow
   */
  private aggregateVotes(votes: CouncilVote[]): CouncilResult {
    const flaggedCount = votes.filter(v => v.flagged).length;
    const cleanCount = votes.length - flaggedCount;
    
    const unanimous = flaggedCount === votes.length || cleanCount === votes.length;
    const majorityFlagged = flaggedCount > cleanCount;
    
    const avgConfidence = votes.reduce((sum, v) => sum + v.confidence, 0) / votes.length;
    const majorityConfidence = majorityFlagged
      ? votes.filter(v => v.flagged).reduce((sum, v) => sum + v.confidence, 0) / flaggedCount
      : votes.filter(v => !v.flagged).reduce((sum, v) => sum + v.confidence, 0) / cleanCount;
    
    // Hybrid decision logic
    let decision: 'flagged' | 'clean' | 'human_review';
    let decisionReason: string;
    
    if (unanimous && this.config.unanimousAutoDecide) {
      // Unanimous vote - auto-decide
      decision = majorityFlagged ? 'flagged' : 'clean';
      decisionReason = `Unanimous council decision (${votes.length}-0)`;
    } else if (flaggedCount !== cleanCount) {
      // Majority exists
      if (majorityConfidence >= this.config.majorityConfidenceThreshold) {
        // High confidence majority - auto-decide
        decision = majorityFlagged ? 'flagged' : 'clean';
        decisionReason = `Majority decision (${Math.max(flaggedCount, cleanCount)}-${Math.min(flaggedCount, cleanCount)}) with ${(majorityConfidence * 100).toFixed(0)}% confidence`;
      } else if (this.config.sendLowConfidenceToHuman) {
        // Low confidence majority - human review
        decision = 'human_review';
        decisionReason = `Majority (${Math.max(flaggedCount, cleanCount)}-${Math.min(flaggedCount, cleanCount)}) but low confidence (${(majorityConfidence * 100).toFixed(0)}%)`;
      } else {
        // Config says don't send to human, use majority
        decision = majorityFlagged ? 'flagged' : 'clean';
        decisionReason = `Majority decision with low confidence (human review disabled)`;
      }
    } else if (this.config.sendSplitsToHuman) {
      // Split vote - human review
      decision = 'human_review';
      decisionReason = `Council split (${flaggedCount}-${cleanCount})`;
    } else {
      // Config says don't send splits to human, default to flagged (safer)
      decision = 'flagged';
      decisionReason = `Council split, defaulting to flagged (human review disabled)`;
    }
    
    return {
      votes,
      unanimous,
      majorityFlagged,
      majorityConfidence,
      averageConfidence: avgConfidence,
      decision,
      decisionReason,
    };
  }
  
  /**
   * Add item to human review queue
   */
  queueForHumanReview(
    text: string,
    normalized: string,
    primaryResult: ProviderResult,
    councilResult: CouncilResult | undefined,
    reason: HumanReviewReason
  ): HumanReviewItem {
    const item: HumanReviewItem = {
      id: this.generateId(),
      text,
      normalized,
      primaryResult,
      councilResult,
      reason,
      priority: this.calculatePriority(primaryResult, councilResult),
      createdAt: new Date(),
      status: 'pending',
    };
    
    this.humanReviewQueue.push(item);
    return item;
  }
  
  /**
   * Get pending human review items
   */
  getHumanReviewQueue(): HumanReviewItem[] {
    return this.humanReviewQueue
      .filter(item => item.status === 'pending')
      .sort((a, b) => b.priority - a.priority);
  }
  
  /**
   * Submit human decision for a review item
   */
  submitHumanDecision(
    itemId: string,
    decision: {
      flagged: boolean;
      categories: (keyof CategoryScores)[];
      notes: string;
      decidedBy: string;
    }
  ): boolean {
    const item = this.humanReviewQueue.find(i => i.id === itemId);
    if (!item) return false;
    
    item.status = 'decided';
    item.humanDecision = {
      ...decision,
      decidedAt: new Date(),
    };
    
    return true;
  }
  
  /**
   * Log an audit entry
   */
  logAudit(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): AuditLogEntry {
    const fullEntry: AuditLogEntry = {
      id: this.generateId(),
      timestamp: new Date(),
      ...entry,
    };
    
    this.auditLog.push(fullEntry);
    return fullEntry;
  }
  
  /**
   * Get audit log entries
   */
  getAuditLog(limit?: number): AuditLogEntry[] {
    const log = [...this.auditLog].reverse();
    return limit ? log.slice(0, limit) : log;
  }
  
  /**
   * Export audit log for analysis/compliance
   */
  exportAuditLog(): string {
    return JSON.stringify(this.auditLog, null, 2);
  }
  
  /**
   * Get council statistics
   */
  getStats(): {
    totalDecisions: number;
    escalatedToCouncil: number;
    sentToHumanReview: number;
    councilUnanimous: number;
    councilMajority: number;
    councilSplit: number;
  } {
    const escalated = this.auditLog.filter(e => e.escalated);
    const humanReview = this.auditLog.filter(e => e.humanReview);
    const councilResults = escalated.filter(e => e.councilResult);
    
    return {
      totalDecisions: this.auditLog.length,
      escalatedToCouncil: escalated.length,
      sentToHumanReview: humanReview.length,
      councilUnanimous: councilResults.filter(e => e.councilResult?.unanimous).length,
      councilMajority: councilResults.filter(e => !e.councilResult?.unanimous && e.councilResult?.decision !== 'human_review').length,
      councilSplit: councilResults.filter(e => e.councilResult?.decision === 'human_review').length,
    };
  }
  
  /**
   * Get available council members
   */
  getMembers(): string[] {
    return this.members.map(m => m.name);
  }
  
  /**
   * Update configuration
   */
  configure(config: Partial<CouncilConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.members) {
      this.members = this.initializeMembers();
    }
  }
  
  // =============================================================================
  // HELPERS
  // =============================================================================
  
  private timeout(ms: number): Promise<null> {
    return new Promise(resolve => setTimeout(() => resolve(null), ms));
  }
  
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  private calculatePriority(primaryResult: ProviderResult, councilResult?: CouncilResult): number {
    // Higher severity = higher priority
    let priority = primaryResult.confidence * 50;
    
    // Council splits are higher priority
    if (councilResult && !councilResult.unanimous) {
      priority += 25;
    }
    
    // Certain categories are higher priority
    const highPriorityCategories: (keyof CategoryScores)[] = ['child_safety', 'threats', 'self_harm'];
    for (const cat of highPriorityCategories) {
      if ((primaryResult.categories[cat] || 0) > 0.5) {
        priority += 20;
      }
    }
    
    return Math.min(priority, 100);
  }
}

