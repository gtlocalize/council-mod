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
import { analyzeLanguage, LanguageAnalysis } from './language';
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
  FinalAction,
  SuggestedAction,
  ContextFactors,
  FlaggedSpan,
  FastPathConfig,
  DEFAULT_FAST_PATH_CONFIG,
  ModerateOptions,
  ContextMessage,
} from './types';

// Track if we've shown the context warning (only show once per session)
let hasShownContextWarning = false;

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
  language?: LanguageAnalysis;
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
   * 
   * @param text - The text to moderate
   * @param options - Optional context and metadata
   */
  async moderate(text: string, options?: ModerateOptions): Promise<ExtendedModerationResult> {
    const startTime = performance.now();
    const warnings: string[] = [];
    
    // =======================================================================
    // CONTEXT HANDLING
    // =======================================================================
    
    const contextProvided = !!(options?.context && options.context.length > 0);
    const isShortText = text.trim().length <= 10;
    const isAmbiguous = this.isAmbiguousTerm(text);
    
    // Warn developers about missing context (once per session)
    if (!contextProvided && !hasShownContextWarning) {
      console.warn(
        '⚠️  council-mod: No context provided. For better accuracy with ambiguous terms, ' +
        'pass previous messages: moderate(text, { context: [...] }). ' +
        'See: https://github.com/gtlocalize/council-mod#context'
      );
      hasShownContextWarning = true;
    }
    
    // Add warning to result if no context for ambiguous content
    if (!contextProvided && (isShortText || isAmbiguous)) {
      warnings.push(
        'No context provided. Short or ambiguous terms may be misclassified. ' +
        'Consider passing previous messages for better accuracy.'
      );
    }
    
    // Build full text with context for API calls
    const textWithContext = this.buildTextWithContext(text, options?.context);
    
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
    
    // Detect language/script for routing decisions
    const languageInfo = analyzeLanguage(text);
    
    // Check if we can fast-path (skip API)
    // BUT: If short/ambiguous without context, don't fast-path to DENY
    let fastPathDecision = this.evaluateFastPath(localResult, languageInfo);
    
    // Override: ambiguous without context should ESCALATE, not DENY
    if (!contextProvided && isAmbiguous && fastPathDecision.action === 'deny') {
      fastPathDecision = {
        canFastPath: false,
        action: 'escalate',
        reason: 'Ambiguous term without context, escalating for safety',
      };
    }
    
    let tierInfo: TierInfo = {
      tier: 'local',
      reason: fastPathDecision.reason,
      localLatencyMs,
      skippedApi: false,
      skippedCouncil: false,
      language: languageInfo,
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
          flagged: fastPathDecision.action === 'deny',
          action: fastPathDecision.action,
          confidence: localResult.confidence,
          decisionSource: 'primary',
        },
        processingTimeMs,
      });
      
      return {
        action: fastPathDecision.action,
        flagged: fastPathDecision.action === 'deny',
        severity,
        confidence: localResult.confidence,
        categories: localResult.categories,
        contextFactors,
        flaggedSpans,
        normalized: normalizedText,
        original: text,
        processingTimeMs,
        tierInfo,
        contextProvided,
        warnings,
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
      // Pass context to council - Claude/Gemini/DeepSeek understand conversational context
      councilResult = await this.council.convene(textWithContext, apiResult);
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
    
    const confidence = councilResult 
      ? councilResult.averageConfidence 
      : apiResult.confidence;
    
    // Determine final action using the new 3-outcome model
    let finalAction: FinalAction;
    if (councilResult) {
      // Council made a decision
      if (councilResult.decision === 'human_review') {
        finalAction = 'escalate';
      } else if (councilResult.decision === 'flagged') {
        finalAction = 'deny';
      } else {
        finalAction = 'allow';
      }
    } else {
      // API-only decision - pass categories so high-severity individual categories trigger DENY
      // Also pass language info - non-Latin scripts need stricter thresholds (API underreports)
      const isNonLatin = tierInfo.language?.shouldSkipFastPath || false;
      finalAction = this.determineAction(adjustedSeverity, confidence, baseCategories, isNonLatin);
    }
    
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
        flagged: finalAction === 'deny',
        action: finalAction,
        confidence,
        decisionSource,
      },
      humanReview: finalAction === 'escalate' 
        ? { itemId: 'pending', status: 'queued' }
        : undefined,
      processingTimeMs,
    });
    
    return {
      action: finalAction,
      flagged: finalAction === 'deny',
      severity: adjustedSeverity,
      confidence,
      categories: baseCategories,
      contextFactors,
      flaggedSpans,
      normalized: normalizedText,
      original: text,
      processingTimeMs,
      tierInfo,
      contextProvided,
      warnings,
    };
  }
  
  /**
   * Evaluate if we can use fast-path (skip API)
   */
  private evaluateFastPath(localResult: LocalProviderResult, languageInfo: LanguageAnalysis): {
    canFastPath: boolean;
    action: FinalAction;
    reason: string;
  } {
    const fp = this.config.fastPath;
    const meta = localResult.localMeta;
    
    // NON-LATIN SCRIPTS: Always go to API
    // Our local patterns only work for Latin text
    if (languageInfo.shouldSkipFastPath) {
      return {
        canFastPath: false,
        action: 'escalate',
        reason: `Non-Latin script (${languageInfo.script}) detected, requires API analysis`,
      };
    }
    
    // Check for high-priority categories that always need API verification
    for (const cat of fp.alwaysCheckCategories) {
      const score = localResult.categories[cat] || 0;
      if (score > 0.3) {
        return {
          canFastPath: false,
          action: 'escalate',
          reason: `High-priority category ${cat} detected (${(score * 100).toFixed(0)}%), needs API verification`,
        };
      }
    }
    
    // Check confidence threshold
    if (localResult.confidence < fp.minLocalConfidence) {
      return {
        canFastPath: false,
        action: 'escalate',
        reason: `Local confidence ${(localResult.confidence * 100).toFixed(0)}% below threshold ${(fp.minLocalConfidence * 100).toFixed(0)}%`,
      };
    }
    
    // HIGH SEVERITY + HIGH CONFIDENCE: Fast-path DENY
    if (meta.adjustedSeverity >= fp.localBlockThreshold) {
      return {
        canFastPath: true,
        action: 'deny',
        reason: `High local severity ${(meta.adjustedSeverity * 100).toFixed(0)}% >= ${(fp.localBlockThreshold * 100).toFixed(0)}% threshold`,
      };
    }
    
    // LOW SEVERITY + HIGH CONFIDENCE: Fast-path ALLOW
    if (meta.adjustedSeverity <= fp.localAllowThreshold && meta.detectedTerms.length === 0) {
      return {
        canFastPath: true,
        action: 'allow',
        reason: meta.cleanIndicators 
          ? 'Clean text indicators detected, high confidence allow'
          : `Low local severity ${(meta.adjustedSeverity * 100).toFixed(0)}% <= ${(fp.localAllowThreshold * 100).toFixed(0)}% threshold`,
      };
    }
    
    // MEDIUM SEVERITY: Need API (escalate)
    return {
      canFastPath: false,
      action: 'escalate',
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
   * Check if a term is ambiguous (could be innocent or harmful depending on context)
   * These are terms that NEED context to moderate correctly
   */
  private isAmbiguousTerm(text: string): boolean {
    const trimmed = text.trim().toLowerCase();
    
    // Very short text is inherently ambiguous
    if (trimmed.length <= 5) return true;
    
    // Japanese ambiguous terms (phonetic overlaps)
    // にがー = could be "bitter" (苦い) or n-word
    const japaneseAmbiguous = ['にがー', 'ニガー', 'にが'];
    if (japaneseAmbiguous.some(term => trimmed.includes(term))) return true;
    
    // Single words are often ambiguous
    if (!trimmed.includes(' ') && trimmed.length <= 10) return true;
    
    return false;
  }
  
  /**
   * Build text with context for API calls
   * Formats context messages before the main text
   */
  private buildTextWithContext(
    text: string, 
    context?: string[] | ContextMessage[]
  ): string {
    if (!context || context.length === 0) {
      return text;
    }
    
    // Convert to strings if rich objects
    const contextStrings = context.map(c => 
      typeof c === 'string' ? c : c.text
    );
    
    // Format: context messages, then separator, then main text
    const contextBlock = contextStrings
      .map((msg, i) => `[${i + 1}] ${msg}`)
      .join('\n');
    
    return `Previous messages:\n${contextBlock}\n\n---\nMessage to moderate:\n${text}`;
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
   * Determine final action based on severity, confidence, and category scores
   * 
   * Logic:
   * - ANY high-priority category >= threshold → DENY (regardless of average)
   * - For non-Latin: use LOWER threshold (APIs underreport non-English hate speech)
   * - Severity >= denyThreshold AND confident → DENY
   * - Severity < allowThreshold AND confident → ALLOW
   * - Not confident OR severity in middle → ESCALATE
   */
  private determineAction(
    severity: number, 
    confidence: number, 
    categories?: CategoryScores,
    isNonLatin: boolean = false
  ): FinalAction {
    const isConfident = confidence >= this.config.confidenceThreshold;
    
    // HIGH-PRIORITY CATEGORY CHECK
    // If ANY of these categories crosses the threshold, it's DENY
    // Don't let averaging hide obvious hate speech
    if (categories) {
      const highPriorityCategories: ModerationCategory[] = [
        'hate_speech', 
        'harassment', 
        'violence', 
        'threats',
        'child_safety',
        'self_harm',
      ];
      
      // For non-Latin scripts, use a LOWER threshold
      // OpenAI's API significantly underreports hate speech in Chinese, Arabic, etc.
      // A 50% hate_speech score in Chinese is probably 80%+ in reality
      const effectiveThreshold = isNonLatin 
        ? this.config.denyThreshold * 0.6  // 70% * 0.6 = 42%
        : this.config.denyThreshold;
      
      for (const cat of highPriorityCategories) {
        const score = categories[cat] || 0;
        if (score >= effectiveThreshold) {
          return 'deny';
        }
      }
    }
    
    if (!isConfident) {
      // Not confident enough → escalate for more review
      return 'escalate';
    }
    
    if (severity < this.config.allowThreshold) {
      return 'allow';
    }
    
    if (severity >= this.config.denyThreshold) {
      return 'deny';
    }
    
    // Severity in the middle (allowThreshold to denyThreshold) → escalate
    return 'escalate';
  }
  
  /** @deprecated Use determineAction instead */
  private determineSuggestedAction(severity: number): SuggestedAction {
    if (severity >= 0.9) return 'block';
    if (severity >= 0.7) return 'review';
    if (severity >= 0.3) return 'warn';
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
