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

/**
 * Final decision outcomes:
 * - allow: Content is acceptable
 * - deny: Content should be blocked/removed
 * - escalate: Not confident enough, needs higher-tier review
 */
export type FinalAction = 'allow' | 'deny' | 'escalate';

/** @deprecated Use FinalAction instead */
export type SuggestedAction = 'allow' | 'warn' | 'review' | 'block';

export interface ModerationResult {
  /** Final action: allow, deny, or escalate */
  action: FinalAction;
  
  /** Whether content was flagged as potentially harmful */
  flagged: boolean;
  
  /** Overall severity score 0.0 - 1.0 */
  severity: number;
  
  /** Model confidence in this decision 0.0 - 1.0 */
  confidence: number;
  
  /** Per-category confidence scores */
  categories: CategoryScores;
  
  /** Context analysis (intent, target, reclamation, etc.) */
  contextFactors: ContextFactors;
  
  /** Specific flagged portions of text */
  flaggedSpans: FlaggedSpan[];
  
  /** Text after normalization */
  normalized: string;
  
  /** Original input text */
  original: string;
  
  /** Processing latency in milliseconds */
  processingTimeMs: number;
  
  /** Whether context was provided for this moderation */
  contextProvided: boolean;
  
  /** Warnings about the moderation (e.g., "No context provided") */
  warnings: string[];
  
  /** @deprecated Use 'action' instead */
  suggestedAction?: SuggestedAction;
}

// =============================================================================
// CONTEXT OPTIONS
// =============================================================================

/** Context message for richer analysis */
export interface ContextMessage {
  text: string;
  userId?: string;
  timestamp?: Date;
}

/** Options for moderate() call */
export interface ModerateOptions {
  /** Previous messages for context (array of strings or rich objects) */
  context?: string[] | ContextMessage[];
  
  /** User ID of the person who sent the message being moderated */
  userId?: string;
  
  /** Platform identifier (youtube, discord, twitch, etc.) */
  platform?: string;
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
  
  // Thresholds for decision making
  /** Severity below this = ALLOW (default 0.3) */
  allowThreshold: number;
  
  /** Severity above this = DENY (default 0.7) */
  denyThreshold: number;
  
  /** Confidence below this = ESCALATE (default 0.7) */
  confidenceThreshold: number;
  
  /** @deprecated Use allowThreshold */
  severityThreshold?: number;
  /** @deprecated Use denyThreshold */
  reviewThreshold?: number;
  /** @deprecated */
  blockThreshold?: number;
  
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
  allowThreshold: 0.3,      // Severity < 30% = ALLOW
  denyThreshold: 0.7,       // Severity > 70% = DENY
  confidenceThreshold: 0.7, // Confidence < 70% = ESCALATE
  enabledCategories: [],    // Empty = all categories
  fastPath: DEFAULT_FAST_PATH_CONFIG,
};

// =============================================================================
// LEGACY TYPES (for backwards compatibility)
// =============================================================================

export type ProfanityCheckConfig = {
  checkManualProfanityList: boolean;
  provider: string;
};
