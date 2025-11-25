/**
 * Content Moderator
 * 
 * Main orchestrator with TIERED FAST-PATH architecture:
 * 
 * TIER 1: Local (~3ms) - Catches obvious slurs, clear profanity, clean text
 * TIER 2: API (~800ms) - Nuanced detection for uncertain cases
 * TIER 3: Council (~2-3s) - Multi-model consensus for edge cases
 */

import { TextNormalizer, normalizer } from './normalizer';
import { ContextEvaluator, contextEvaluator } from './context';
import { Council, CouncilConfig, DEFAULT_COUNCIL_CONFIG } from './council';
import {
  createProvider,
  ProviderName,
  ModerationProvider,
  ProviderResult,
  AuditLogEntry,
  HumanReviewItem,
  LocalProviderResult,
} from './providers';
import { LocalProvider } from './providers/local';
import {
  ModerationResult,
  ModeratorConfig,
  DEFAULT_CONFIG,
  CategoryScores,
  ModerationCategory,
  SuggestedAction,
  ContextFactors,
  FlaggedSpan,
  FastPathConfig,
  DEFAULT_FAST_PATH_CONFIG,
} from './types';

// =============================================================================
// EXTENDED CONFIG
// =============================================================================

export interface ExtendedModeratorConfig extends ModeratorConfig {
  // Council settings
  council: Partial<CouncilConfig> & { enabled: boolean };
}

export const DEFAULT_EXTENDED_CONFIG: ExtendedModeratorConfig = {
  ...DEFAULT_CONFIG,
  council: {
    enabled: true,
    ...DEFAULT_COUNCIL_CONFIG,
  },
};

// =============================================================================
// TIER TRACKING
// =============================================================================

export type DecisionTier = 'local' | 'api' | 'council' | 'human';

export interface TierInfo {
  tier: DecisionTier;
  reason: string;
  localLatencyMs: number;
  apiLatencyMs?: number;
  councilLatencyMs?: number;
  skippedApi: boolean;
  skippedCouncil: boolean;
}

// =============================================================================
// EXTENDED RESULT
// =============================================================================

export interface ExtendedModerationResult extends ModerationResult {
  tierInfo: TierInfo;
}

// =============================================================================
// SEVERE SLURS (always flag locally)
// =============================================================================

const SEVERE_SLURS = [
  'nigger', 'nigga', 'kike', 'spic', 'chink', 'gook', 'wetback',
  'faggot', 'fag', 'dyke', 'tranny', 'cunt', 'retard',
];

// =============================================================================
// MODERATOR CLASS
// =============================================================================

export class Moderator {
  private config: ExtendedModeratorConfig;
  private normalizer: TextNormalizer;
  private contextEvaluator: ContextEvaluator;
  private primaryProvider: ModerationProvider;
  private localProvider: LocalProvider;
  private council: Council;
  
  constructor(config: Partial<ExtendedModeratorConfig> = {}) {
    this.config = { 
      ...DEFAULT_EXTENDED_CONFIG, 
      ...config,
      council: { ...DEFAULT_EXTENDED_CONFIG.council, ...config.council },
      fastPath: { ...DEFAULT_FAST_PATH_CONFIG, ...config.fastPath },
    };
    
    this.normalizer = normalizer;
    this.contextEvaluator = contextEvaluator;
    
    // Initialize local provider (always available for fast-path)
    this.localProvider = new LocalProvider();
    
    // Initialize primary API provider
    const providerName = this.config.provider === 'local-only' ? 'local' : this.config.provider;
    this.primaryProvider = createProvider(
      providerName as ProviderName,
      { apiKey: this.config.openaiApiKey || this.config.googlePerspectiveApiKey }
    );
    
    // Initialize council
    this.council = new Council(this.config.council);
  }
  
  /**
   * Main moderation method with tiered fast-path
   */
  async moderate(text: string): Promise<ExtendedModerationResult> {
    const startTime = performance.now();
    
    // =======================================================================
    // TIER 1: LOCAL FAST-PATH (~3ms)
    // =======================================================================
    
    const localStart = performance.now();
    
    // Normalize text
    let normalizedText = text;
    if (this.config.normalizeText) {
      const normResult = this.normalizer.normalize(text);
      normalizedText = normResult.normalized;
    }
    
    // Run local analysis
    const localResult = await this.localProvider.analyze(normalizedText) as LocalProviderResult;
    const localLatencyMs = performance.now() - localStart;
    
    // Check if we can fast-path (skip API)
    const fastPathDecision = this.evaluateFastPath(localResult);
    
    let tierInfo: TierInfo = {
      tier: 'local',
      reason: fastPathDecision.reason,
      localLatencyMs,
      skippedApi: false,
      skippedCouncil: false,
    };
    
    // If fast-path says we're confident, return early
    if (fastPathDecision.canFastPath && this.config.fastPath.enabled) {
      const contextFactors = this.config.analyzeContext 
        ? this.contextEvaluator.evaluate(text)
        : this.getDefaultContextFactors();
      
      const severity = localResult.localMeta.adjustedSeverity;
      const flaggedSpans = this.identifyFlaggedSpans(
        text, 
        normalizedText, 
        localResult.categories, 
        localResult.localMeta.detectedTerms
      );
      
      tierInfo.skippedApi = true;
      tierInfo.skippedCouncil = true;
      
      const processingTimeMs = performance.now() - startTime;
      
      // Log audit
      this.council.logAudit({
        input: { original: text, normalized: normalizedText },
        primaryResult: localResult,
        escalated: false,
        finalDecision: {
          flagged: fastPathDecision.action === 'block',
          action: fastPathDecision.action,
          confidence: localResult.confidence,
          decisionSource: 'primary',
        },
        processingTimeMs,
      });
      
      return {
        flagged: fastPathDecision.action === 'block' || fastPathDecision.action === 'warn',
        severity,
        categories: localResult.categories,
        contextFactors,
        suggestedAction: fastPathDecision.action,
        confidence: localResult.confidence,
        flaggedSpans,
        normalized: normalizedText,
        original: text,
        processingTimeMs,
        tierInfo,
      };
    }
    
    // =======================================================================
    // TIER 2: API CHECK (~800ms)
    // =======================================================================
    
    tierInfo.tier = 'api';
    tierInfo.reason = 'Local confidence insufficient, calling API';
    
    const apiStart = performance.now();
    let apiResult: ProviderResult;
    
    try {
      if (this.primaryProvider.isAvailable() && this.config.provider !== 'local-only') {
        apiResult = await this.primaryProvider.analyze(normalizedText);
      } else {
        // No API available, use local result
        apiResult = localResult;
        tierInfo.reason = 'API unavailable, using local result';
      }
    } catch (err) {
      console.error('API provider failed, using local:', err);
      apiResult = localResult;
      tierInfo.reason = 'API failed, using local result';
    }
    
    tierInfo.apiLatencyMs = performance.now() - apiStart;
    
    // Merge local and API results (local catches obfuscated slurs API might miss)
    const mergedCategories = this.mergeCategories(apiResult.categories, [{ categories: localResult.categories }]);
    
    // =======================================================================
    // TIER 3: COUNCIL ESCALATION (if needed)
    // =======================================================================
    
    let councilResult = undefined;
    let decisionSource: 'primary' | 'council' | 'human' = 'primary';
    
    if (this.config.council.enabled && this.council.shouldEscalate(apiResult)) {
      tierInfo.tier = 'council';
      tierInfo.reason = `API confidence ${(apiResult.confidence * 100).toFixed(0)}% in escalation range`;
      
      const councilStart = performance.now();
      councilResult = await this.council.convene(normalizedText, apiResult);
      tierInfo.councilLatencyMs = performance.now() - councilStart;
      
      if (councilResult.decision === 'human_review') {
        tierInfo.tier = 'human';
        tierInfo.reason = councilResult.decisionReason;
        this.council.queueForHumanReview(
          text,
          normalizedText,
          apiResult,
          councilResult,
          councilResult.unanimous ? 'low_confidence' : 'council_split'
        );
        decisionSource = 'human';
      } else {
        decisionSource = 'council';
      }
    } else {
      tierInfo.skippedCouncil = true;
    }
    
    // =======================================================================
    // FINAL DECISION
    // =======================================================================
    
    const contextFactors = this.config.analyzeContext 
      ? this.contextEvaluator.evaluate(text)
      : this.getDefaultContextFactors();
    
    const baseCategories = councilResult 
      ? this.mergeCategories(mergedCategories, councilResult.votes)
      : mergedCategories;
    
    const rawSeverity = this.calculateSeverity(baseCategories);
    const harmReduction = this.contextEvaluator.calculateHarmReduction(contextFactors);
    const adjustedSeverity = Math.min(rawSeverity * harmReduction, 1.0);
    
    const finalFlagged = councilResult 
      ? (councilResult.decision === 'flagged' || (councilResult.decision === 'human_review' && adjustedSeverity > 0.5))
      : adjustedSeverity >= this.config.severityThreshold;
    
    const suggestedAction = councilResult?.decision === 'human_review'
      ? 'review' as SuggestedAction
      : this.determineSuggestedAction(adjustedSeverity);
    
    const confidence = councilResult 
      ? councilResult.averageConfidence 
      : apiResult.confidence;
    
    const flaggedSpans = this.identifyFlaggedSpans(
      text, 
      normalizedText, 
      baseCategories, 
      localResult.localMeta.detectedTerms
    );
    
    const processingTimeMs = performance.now() - startTime;
    
    // Log audit
    this.council.logAudit({
      input: { original: text, normalized: normalizedText },
      primaryResult: apiResult,
      escalated: !!councilResult,
      councilResult,
      finalDecision: {
        flagged: finalFlagged,
        action: suggestedAction,
        confidence,
        decisionSource,
      },
      humanReview: councilResult?.decision === 'human_review' 
        ? { itemId: 'pending', status: 'queued' }
        : undefined,
      processingTimeMs,
    });
    
    return {
      flagged: finalFlagged,
      severity: adjustedSeverity,
      categories: baseCategories,
      contextFactors,
      suggestedAction,
      confidence,
      flaggedSpans,
      normalized: normalizedText,
      original: text,
      processingTimeMs,
      tierInfo,
    };
  }
  
  /**
   * Evaluate if we can use fast-path (skip API)
   */
  private evaluateFastPath(localResult: LocalProviderResult): {
    canFastPath: boolean;
    action: SuggestedAction;
    reason: string;
  } {
    const fp = this.config.fastPath;
    const meta = localResult.localMeta;
    
    // Check for high-priority categories that always need API verification
    for (const cat of fp.alwaysCheckCategories) {
      const score = localResult.categories[cat] || 0;
      if (score > 0.3) {
        return {
          canFastPath: false,
          action: 'review',
          reason: `High-priority category ${cat} detected (${(score * 100).toFixed(0)}%), needs API verification`,
        };
      }
    }
    
    // Check confidence threshold
    if (localResult.confidence < fp.minLocalConfidence) {
      return {
        canFastPath: false,
        action: 'review',
        reason: `Local confidence ${(localResult.confidence * 100).toFixed(0)}% below threshold ${(fp.minLocalConfidence * 100).toFixed(0)}%`,
      };
    }
    
    // HIGH SEVERITY: Fast-path BLOCK
    if (meta.adjustedSeverity >= fp.localBlockThreshold) {
      return {
        canFastPath: true,
        action: 'block',
        reason: `High local severity ${(meta.adjustedSeverity * 100).toFixed(0)}% >= ${(fp.localBlockThreshold * 100).toFixed(0)}% threshold`,
      };
    }
    
    // LOW SEVERITY: Fast-path ALLOW
    if (meta.adjustedSeverity <= fp.localAllowThreshold && meta.detectedTerms.length === 0) {
      return {
        canFastPath: true,
        action: 'allow',
        reason: meta.cleanIndicators 
          ? 'Clean text indicators detected, high confidence allow'
          : `Low local severity ${(meta.adjustedSeverity * 100).toFixed(0)}% <= ${(fp.localAllowThreshold * 100).toFixed(0)}% threshold`,
      };
    }
    
    // MEDIUM SEVERITY: Need API
    return {
      canFastPath: false,
      action: 'review',
      reason: `Local severity ${(meta.adjustedSeverity * 100).toFixed(0)}% in uncertain range, needs API`,
    };
  }
  
  /**
   * Default context factors when not analyzing context
   */
  private getDefaultContextFactors(): ContextFactors {
    return {
      intent: 'unknown',
      target: 'none',
      isReclamation: false,
      isEducational: false,
      isQuoted: false,
      isSelfReferential: false,
      sentiment: 'neutral',
    };
  }
  
  /**
   * Merge categories from multiple sources
   */
  private mergeCategories(primary: CategoryScores, others: Array<{ categories: CategoryScores }>): CategoryScores {
    const merged: CategoryScores = { ...primary };
    
    for (const other of others) {
      for (const [key, value] of Object.entries(other.categories)) {
        if (value !== undefined) {
          const k = key as keyof CategoryScores;
          merged[k] = Math.max(merged[k] || 0, value);
        }
      }
    }
    
    return merged;
  }
  
  /**
   * Calculate overall severity from category scores
   */
  private calculateSeverity(categories: CategoryScores): number {
    const weights: Record<ModerationCategory, number> = {
      hate_speech: 1.0,
      harassment: 0.9,
      sexual_harassment: 0.9,
      violence: 0.9,
      threats: 1.0,
      self_harm: 0.8,
      drugs_illegal: 0.6,
      profanity: 0.4,
      child_safety: 1.0,
      personal_info: 0.7,
      spam_scam: 0.5,
    };
    
    let maxWeighted = 0;
    for (const [category, score] of Object.entries(categories)) {
      if (score !== undefined) {
        const weight = weights[category as ModerationCategory] || 0.5;
        maxWeighted = Math.max(maxWeighted, score * weight);
      }
    }
    
    return maxWeighted;
  }
  
  /**
   * Determine suggested action based on severity
   */
  private determineSuggestedAction(severity: number): SuggestedAction {
    if (severity >= this.config.blockThreshold) return 'block';
    if (severity >= this.config.reviewThreshold) return 'review';
    if (severity >= this.config.severityThreshold) return 'warn';
    return 'allow';
  }
  
  /**
   * Identify specific spans of flagged content
   */
  private identifyFlaggedSpans(
    original: string,
    normalized: string,
    categories: CategoryScores,
    foundTerms: string[]
  ): FlaggedSpan[] {
    const spans: FlaggedSpan[] = [];
    const lowerNormalized = normalized.toLowerCase();
    
    for (const term of foundTerms) {
      const regex = new RegExp(`\\b${term}s?\\b`, 'gi');
      let match;
      while ((match = regex.exec(lowerNormalized)) !== null) {
        const cats: ModerationCategory[] = ['profanity'];
        if (SEVERE_SLURS.includes(term)) {
          cats.push('hate_speech');
        }
        
        spans.push({
          start: match.index,
          end: match.index + match[0].length,
          original: match[0],
          normalized: match[0],
          categories: cats,
          severity: SEVERE_SLURS.includes(term) ? 0.9 : 0.5,
        });
      }
    }
    
    return spans;
  }
  
  // =============================================================================
  // PUBLIC API
  // =============================================================================
  
  /**
   * Quick check - always local only, ~3ms
   */
  async quickCheck(text: string): Promise<{ flagged: boolean; severity: number; latencyMs: number }> {
    const start = performance.now();
    const normResult = this.normalizer.normalize(text);
    const result = await this.localProvider.analyze(normResult.normalized) as LocalProviderResult;
    return {
      flagged: result.localMeta.adjustedSeverity > 0.3,
      severity: result.localMeta.adjustedSeverity,
      latencyMs: performance.now() - start,
    };
  }
  
  /**
   * Get human review queue
   */
  getHumanReviewQueue(): HumanReviewItem[] {
    return this.council.getHumanReviewQueue();
  }
  
  /**
   * Submit human decision
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
    return this.council.submitHumanDecision(itemId, decision);
  }
  
  /**
   * Get audit log
   */
  getAuditLog(limit?: number): AuditLogEntry[] {
    return this.council.getAuditLog(limit);
  }
  
  /**
   * Export audit log
   */
  exportAuditLog(): string {
    return this.council.exportAuditLog();
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return this.council.getStats();
  }
  
  /**
   * Get available providers info
   */
  getProviderInfo() {
    return {
      primary: this.primaryProvider.getInfo(),
      council: this.council.getMembers(),
      fastPathEnabled: this.config.fastPath.enabled,
    };
  }
  
  /**
   * Update configuration
   */
  configure(config: Partial<ExtendedModeratorConfig>): void {
    this.config = { 
      ...this.config, 
      ...config,
      fastPath: { ...this.config.fastPath, ...config.fastPath },
    };
    
    if (config.provider || config.openaiApiKey || config.googlePerspectiveApiKey) {
      const providerName = this.config.provider === 'local-only' ? 'local' : this.config.provider;
      this.primaryProvider = createProvider(
        providerName as ProviderName,
        { apiKey: this.config.openaiApiKey || this.config.googlePerspectiveApiKey }
      );
    }
    
    if (config.council) {
      this.council.configure(config.council);
    }
  }
  
  /**
   * Get current configuration
   */
  getConfig(): ExtendedModeratorConfig {
    return { ...this.config };
  }
}

// Export factory function
export function createModerator(config?: Partial<ExtendedModeratorConfig>): Moderator {
  return new Moderator(config);
}
