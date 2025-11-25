// Legacy export (backwards compatibility)
export { Filter } from "./filter";

// New moderation system
export { 
  Moderator, 
  createModerator, 
  ExtendedModeratorConfig,
  ExtendedModerationResult,
  TierInfo,
  DecisionTier,
} from "./moderator";
export { TextNormalizer, normalizer } from "./normalizer";
export { ContextEvaluator, contextEvaluator } from "./context";
export { Council, CouncilConfig, DEFAULT_COUNCIL_CONFIG } from "./council";

// Providers
export {
  createProvider,
  getAvailableProviders,
  getAllProviderInfo,
  OpenAIProvider,
  AnthropicProvider,
  PerspectiveProvider,
  GeminiProvider,
  LocalProvider,
} from "./providers";

export type {
  ModerationProvider,
  ProviderResult,
  ProviderInfo,
  ProviderConfig,
  ProviderName,
  CouncilVote,
  CouncilResult,
  HumanReviewItem,
  HumanReviewReason,
  AuditLogEntry,
} from "./providers";

// Types
export type {
  ModerationResult,
  ModeratorConfig,
  CategoryScores,
  ModerationCategory,
  SuggestedAction,
  ContextFactors,
  FlaggedSpan,
  Intent,
  Target,
} from "./types";

export { MODERATION_CATEGORIES, DEFAULT_CONFIG, DEFAULT_FAST_PATH_CONFIG } from "./types";
export type { FastPathConfig } from "./types";
