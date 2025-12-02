/**
 * QA System Types
 * Shared types for test case generation, auditing, and analysis
 */

import { ModerationCategory } from '../src/types';

// =============================================================================
// TEST CASES
// =============================================================================

export type TestCaseType = 'positive' | 'negative' | 'edge' | 'obfuscated' | 'cross';
export type TestLanguage = 'en' | 'ja';

/**
 * Context message with speaker attribution
 * All context messages are chronologically BEFORE the text being moderated
 */
export interface ContextMessage {
  /** Who sent this message relative to the text being moderated */
  speaker: 'same' | 'other';
  /** The message content */
  text: string;
}

export interface TestCase {
  id: string;
  text: string;
  language: TestLanguage;
  category: ModerationCategory;
  type: TestCaseType;
  /** 
   * Previous messages providing context (oldest first)
   * Supports both legacy string[] format and new ContextMessage[] format
   */
  context?: string[] | ContextMessage[];
  metadata: {
    generatedBy: 'claude-opus-4.5' | 'gemini-3-pro' | 'human';
    generatedAt: string;
    prompt?: string;
    reasoning?: string;
  };
}

export interface TestCaseDataset {
  version: string;
  generatedAt: string;
  model: string;
  cases: TestCase[];
  stats: {
    total: number;
    byLanguage: Record<TestLanguage, number>;
    byCategory: Record<string, number>;
    byType: Record<TestCaseType, number>;
  };
}

// =============================================================================
// AUDITS
// =============================================================================

export type AuditAction = 'allow' | 'deny' | 'escalate';
export type AuditorType = 'human' | 'claude-opus-4.5' | 'claude-sonnet-4.5' | 'gemini-3-pro' | 'gpt-5.1';

export interface Audit {
  caseId: string;
  auditor: AuditorType;
  action: AuditAction;
  confidence?: number;
  reasoning?: string;
  comment?: string;  // Human-added note for later review
  timestamp: string;
}

export interface AuditDataset {
  version: string;
  lastUpdated: string;
  audits: Audit[];
  progress: {
    human: { completed: number; total: number };
    llm: { completed: number; total: number };
  };
}

// =============================================================================
// AGREEMENT METRICS
// =============================================================================

export interface AgreementMetrics {
  gwetAC1: number;
  agreements: number;
  disagreements: number;
  total: number;
}

export interface AgreementReport {
  version: string;
  generatedAt: string;
  auditors: {
    primary: AuditorType;
    secondary: AuditorType;
  };
  overall: AgreementMetrics;
  byCategory: Record<string, AgreementMetrics>;
  byType: Record<TestCaseType, AgreementMetrics>;
  byLanguage: Record<TestLanguage, AgreementMetrics>;
  disagreements: Array<{
    caseId: string;
    text: string;
    category: string;
    primaryAction: AuditAction;
    secondaryAction: AuditAction;
  }>;
}

// =============================================================================
// LIBRARY PERFORMANCE
// =============================================================================

export interface CategoryPerformance {
  precision: number;
  recall: number;
  f1Score: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
}

export interface PerformanceReport {
  version: string;
  generatedAt: string;
  config: {
    provider: string;
    councilEnabled: boolean;
  };
  overall: {
    accuracy: number;
    tested: number;
    correct: number;
    incorrect: number;
  };
  byCategory: Record<string, CategoryPerformance>;
  byType: Record<TestCaseType, { accuracy: number; tested: number }>;
  byLanguage: Record<TestLanguage, { accuracy: number; tested: number }>;
  failures: Array<{
    caseId: string;
    text: string;
    category: string;
    expected: AuditAction;
    actual: AuditAction;
    severity: number;
    confidence: number;
  }>;
  latency: {
    average: number;
    p50: number;
    p95: number;
    p99: number;
  };
}

// =============================================================================
// GENERATION CONFIG
// =============================================================================

export interface GenerationConfig {
  model: 'claude-opus-4.5' | 'gemini-3-pro';
  categories: ModerationCategory[];
  languages: TestLanguage[];
  distribution: {
    positive: number;
    negative: number;
    edge: number;
    obfuscated: number;
    cross: number;
  };
  totalTarget: number;
}

export const DEFAULT_GENERATION_CONFIG: GenerationConfig = {
  model: 'claude-opus-4.5',
  categories: [
    'hate_speech',
    'harassment', 
    'sexual_harassment',
    'violence',
    'threats',
    'self_harm',
    'drugs_illegal',
    'profanity',
    // 'child_safety', // Excluded - too sensitive for testing without specialized oversight
    'personal_info',
    'spam_scam',
  ],
  languages: ['en', 'ja'],
  distribution: {
    positive: 20,  // % of cases
    negative: 20,
    edge: 35,      // weighted higher
    obfuscated: 15,
    cross: 10,
  },
  totalTarget: 600,
};

