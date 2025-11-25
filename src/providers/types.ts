/**
 * Provider Types
 * 
 * Unified interface for multiple moderation backends
 */

import { CategoryScores, ModerationCategory } from '../types';

// =============================================================================
// PROVIDER RESULT
// =============================================================================

export interface ProviderResult {
  provider: string;
  flagged: boolean;
  confidence: number;           // 0.0 - 1.0 overall confidence
  categories: CategoryScores;
  rawResponse?: unknown;        // Original API response for debugging
  latencyMs: number;
}

// =============================================================================
// PROVIDER INTERFACE
// =============================================================================

export interface ModerationProvider {
  /** Unique identifier for this provider */
  readonly name: string;
  
  /** Human-readable display name */
  readonly displayName: string;
  
  /** Whether this provider requires an API key */
  readonly requiresApiKey: boolean;
  
  /** Analyze text and return moderation result */
  analyze(text: string): Promise<ProviderResult>;
  
  /** Check if provider is configured and available */
  isAvailable(): boolean;
  
  /** Get provider configuration info */
  getInfo(): ProviderInfo;
}

export interface ProviderInfo {
  name: string;
  displayName: string;
  available: boolean;
  requiresApiKey: boolean;
  categories: ModerationCategory[];
  rateLimit?: {
    requestsPerMinute: number;
    requestsPerDay?: number;
  };
  pricing?: {
    model: 'free' | 'pay-per-request' | 'subscription';
    details?: string;
  };
}

// =============================================================================
// PROVIDER CONFIG
// =============================================================================

export interface ProviderConfig {
  apiKey?: string;
  endpoint?: string;
  timeout?: number;
  retries?: number;
}

// =============================================================================
// COUNCIL TYPES
// =============================================================================

export interface CouncilVote {
  provider: string;
  flagged: boolean;
  confidence: number;
  categories: CategoryScores;
  reasoning?: string;
  latencyMs: number;
}

export interface CouncilResult {
  votes: CouncilVote[];
  unanimous: boolean;
  majorityFlagged: boolean;
  majorityConfidence: number;
  averageConfidence: number;
  decision: 'flagged' | 'clean' | 'human_review';
  decisionReason: string;
}

// =============================================================================
// HUMAN REVIEW TYPES
// =============================================================================

export type HumanReviewReason = 'council_split' | 'low_confidence' | 'high_severity' | 'appeal';

export interface HumanReviewItem {
  id: string;
  text: string;
  normalized: string;
  primaryResult: ProviderResult;
  councilResult?: CouncilResult;
  reason: HumanReviewReason;
  priority: number;              // Higher = more urgent
  createdAt: Date;
  status: 'pending' | 'in_review' | 'decided';
  assignedTo?: string;
  humanDecision?: {
    flagged: boolean;
    categories: ModerationCategory[];
    notes: string;
    decidedBy: string;
    decidedAt: Date;
  };
}

// =============================================================================
// AUDIT LOG TYPES
// =============================================================================

export interface AuditLogEntry {
  id: string;
  timestamp: Date;
  input: {
    original: string;
    normalized: string;
  };
  primaryResult: ProviderResult;
  escalated: boolean;
  councilResult?: CouncilResult;
  finalDecision: {
    flagged: boolean;
    action: 'allow' | 'warn' | 'review' | 'block';
    confidence: number;
    decisionSource: 'primary' | 'council' | 'human';
  };
  humanReview?: {
    itemId: string;
    status: string;
  };
  processingTimeMs: number;
}

