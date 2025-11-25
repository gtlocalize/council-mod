// =============================================================================
// MODERATION CATEGORIES
// =============================================================================

export const MODERATION_CATEGORIES = [
  'hate_speech',
  'harassment', 
  'sexual_harassment',
  'violence',
  'threats',
  'self_harm',
  'drugs_illegal',
  'profanity',
  'personal_info',
  'child_safety',
  'spam_scam',
] as const;

export type ModerationCategory = typeof MODERATION_CATEGORIES[number];

export type CategoryScores = {
  [K in ModerationCategory]?: number; // 0.0 - 1.0 confidence
};

// =============================================================================
// CONTEXT FACTORS
// =============================================================================

export type Intent = 'attack' | 'discuss' | 'quote' | 'reclaim' | 'educational' | 'unknown';
export type Target = 'person' | 'group' | 'self' | 'abstract' | 'none';

export interface ContextFactors {
  intent: Intent;
  target: Target;
  isReclamation: boolean;      // In-group use of slur
  isEducational: boolean;      // Academic/documentary context
  isQuoted: boolean;           // Reporting what someone else said
  isSelfReferential: boolean;  // Talking about oneself
  sentiment: 'positive' | 'negative' | 'neutral';
}

// =============================================================================
// FLAGGED CONTENT
// =============================================================================

export interface FlaggedSpan {
  start: number;           // Start index in original text
  end: number;             // End index in original text
  original: string;        // Original text as written
  normalized: string;      // After normalization (e.g., "n1gg3r" → "nigger")
  categories: ModerationCategory[];
  severity: number;
}

// =============================================================================
// MODERATION RESULT
// =============================================================================

export type SuggestedAction = 'allow' | 'warn' | 'review' | 'block';

export interface ModerationResult {
  flagged: boolean;
  severity: number;                    // 0.0 - 1.0 overall severity
  categories: CategoryScores;          // Per-category confidence scores
  contextFactors: ContextFactors;      // Intent, target, reclamation, etc.
  suggestedAction: SuggestedAction;
  confidence: number;                  // Model confidence in assessment
  flaggedSpans: FlaggedSpan[];         // Specific flagged portions
  normalized: string;                  // Full text after normalization
  original: string;                    // Original input
  processingTimeMs: number;            // For performance tracking
}

// =============================================================================
// CONFIGURATION
// =============================================================================

export interface ModeratorConfig {
  // API Configuration
  openaiApiKey?: string;
  googlePerspectiveApiKey?: string;
  
  // Provider selection
  provider: 'openai' | 'perspective' | 'local-only';
  
  // Behavior
  normalizeText: boolean;              // Apply homoglyph/leetspeak normalization
  analyzeContext: boolean;             // Run context evaluation
  
  // Thresholds
  severityThreshold: number;           // Below this = allow (default 0.3)
  reviewThreshold: number;             // Above this = review (default 0.7)
  blockThreshold: number;              // Above this = block (default 0.9)
  
  // Categories to check (empty = all)
  enabledCategories: ModerationCategory[];
  
  // Custom rules
  customBlocklist?: string[];          // Always flag these (after normalization)
  customAllowlist?: string[];          // Never flag these
  
  // Fast-path configuration
  fastPath: FastPathConfig;
}

// =============================================================================
// FAST-PATH CONFIGURATION
// =============================================================================

export interface FastPathConfig {
  /** Enable fast-path optimization (skip API for obvious cases) */
  enabled: boolean;
  
  /** Skip API and block if local severity >= this (default: 0.85) */
  localBlockThreshold: number;
  
  /** Skip API and allow if local severity <= this (default: 0.10) */
  localAllowThreshold: number;
  
  /** Always send to API if these categories detected locally (even low score) */
  alwaysCheckCategories: ModerationCategory[];
  
  /** Minimum local confidence to trust fast-path decision (default: 0.7) */
  minLocalConfidence: number;
}

export const DEFAULT_FAST_PATH_CONFIG: FastPathConfig = {
  enabled: true,
  localBlockThreshold: 0.85,
  localAllowThreshold: 0.10,
  alwaysCheckCategories: ['self_harm', 'child_safety', 'threats'],
  minLocalConfidence: 0.7,
};

export const DEFAULT_CONFIG: ModeratorConfig = {
  provider: 'openai',
  normalizeText: true,
  analyzeContext: true,
  severityThreshold: 0.3,
  reviewThreshold: 0.7,
  blockThreshold: 0.9,
  enabledCategories: [],  // Empty = all categories
  fastPath: DEFAULT_FAST_PATH_CONFIG,
};

// =============================================================================
// LEGACY TYPES (for backwards compatibility)
// =============================================================================

export type ProfanityCheckConfig = {
  checkManualProfanityList: boolean;
  provider: string;
};
