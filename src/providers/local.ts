/**
 * Local Provider
 * 
 * No external API calls - uses only:
 * - Text normalization
 * - Pattern-based slur detection
 * - Context evaluation
 * 
 * Fast (~3ms), free, designed for fast-path optimization.
 * High confidence on obvious cases, low confidence on ambiguous.
 */

import { ModerationProvider, ProviderResult, ProviderConfig, ProviderInfo } from './types';
import { CategoryScores, ModerationCategory } from '../types';
import { normalizer } from '../normalizer';
import { contextEvaluator } from '../context';

// =============================================================================
// SEVERE SLURS (HIGH CONFIDENCE - instant block candidates)
// These are unambiguous hate speech that warrant high confidence local detection
// =============================================================================

const SEVERE_SLURS: Array<{ 
  pattern: RegExp; 
  categories: (keyof CategoryScores)[]; 
  severity: number;
  confidence: number;
}> = [
  // Racial slurs - very high confidence
  { pattern: /\bn+[i1!|]g+[e3]r+s?\b/i, categories: ['hate_speech', 'profanity'], severity: 0.95, confidence: 0.95 },
  { pattern: /\bn+[i1!|]g+[a@4]+s?\b/i, categories: ['hate_speech', 'profanity'], severity: 0.90, confidence: 0.90 },
  { pattern: /\bk+[i1!|]k+[e3]+s?\b/i, categories: ['hate_speech'], severity: 0.90, confidence: 0.90 },
  { pattern: /\bsp+[i1!|]c+s?\b/i, categories: ['hate_speech'], severity: 0.85, confidence: 0.85 },
  { pattern: /\bch+[i1!|]nk+s?\b/i, categories: ['hate_speech'], severity: 0.85, confidence: 0.85 },
  { pattern: /\bg+[o0]+k+s?\b/i, categories: ['hate_speech'], severity: 0.85, confidence: 0.85 },
  { pattern: /\bw+[e3]tb+[a@4]ck+s?\b/i, categories: ['hate_speech'], severity: 0.85, confidence: 0.85 },
  
  // Homophobic slurs - very high confidence
  { pattern: /\bf+[a@4]g+[o0]+t+s?\b/i, categories: ['hate_speech', 'profanity'], severity: 0.90, confidence: 0.90 },
  { pattern: /\bf+[a@4]g+s?\b/i, categories: ['hate_speech', 'profanity'], severity: 0.85, confidence: 0.85 },
  { pattern: /\bd+y+k+[e3]+s?\b/i, categories: ['hate_speech'], severity: 0.80, confidence: 0.80 },
  { pattern: /\btr+[a@4]nn+(y|[i1!|][e3])+s?\b/i, categories: ['hate_speech'], severity: 0.85, confidence: 0.85 },
  
  // Other severe terms
  { pattern: /\bc+u+n+t+s?\b/i, categories: ['profanity', 'harassment'], severity: 0.80, confidence: 0.85 },
  { pattern: /\br+[e3]t+[a@4]rd+s?\b/i, categories: ['hate_speech'], severity: 0.75, confidence: 0.80 },
];

// =============================================================================
// STANDARD PROFANITY (MEDIUM CONFIDENCE)
// Common but not always harmful - context matters more
// =============================================================================

const PROFANITY_PATTERNS: Array<{ 
  pattern: RegExp; 
  severity: number; 
  confidence: number;
}> = [
  { pattern: /\bf+u+c+k+/i, severity: 0.50, confidence: 0.80 },
  { pattern: /\bs+h+[i1!|]+t+/i, severity: 0.45, confidence: 0.80 },
  { pattern: /\b[a@4]s+s+h+[o0]+l+[e3]+/i, severity: 0.50, confidence: 0.80 },
  { pattern: /\bb+[i1!|]+t+c+h+/i, severity: 0.50, confidence: 0.75 },
  { pattern: /\bd+[a@4]+m+n+/i, severity: 0.25, confidence: 0.85 },
  { pattern: /\bh+[e3]+l+l+\b/i, severity: 0.15, confidence: 0.85 },
  { pattern: /\bc+r+[a@4]+p+/i, severity: 0.20, confidence: 0.85 },
  { pattern: /\bp+[i1!|]+s+s+/i, severity: 0.30, confidence: 0.80 },
];

// =============================================================================
// THREAT PATTERNS (HIGH PRIORITY - always escalate to API)
// =============================================================================

const THREAT_PATTERNS: Array<{
  pattern: RegExp;
  severity: number;
  confidence: number;
  categories: (keyof CategoryScores)[];
}> = [
  { pattern: /\b(kill|murder|shoot|stab)\s+(you|them|him|her|yourself)/i, categories: ['threats', 'violence'], severity: 0.90, confidence: 0.85 },
  { pattern: /\bi('ll|'m going to|will)\s+(kill|murder|hurt|harm)/i, categories: ['threats', 'violence'], severity: 0.85, confidence: 0.80 },
  { pattern: /\b(should|deserve to)\s+(die|be killed|suffer)/i, categories: ['threats', 'violence'], severity: 0.85, confidence: 0.80 },
  { pattern: /\bkill\s+yourself\b/i, categories: ['threats', 'self_harm'], severity: 0.95, confidence: 0.90 },
  { pattern: /\bhope\s+(you|they)\s+die\b/i, categories: ['threats', 'harassment'], severity: 0.80, confidence: 0.80 },
];

// =============================================================================
// SELF-HARM PATTERNS (HIGH PRIORITY - always escalate)
// =============================================================================

const SELF_HARM_PATTERNS: Array<{
  pattern: RegExp;
  severity: number;
  confidence: number;
}> = [
  { pattern: /\b(cut|cutting)\s+(myself|my\s+(wrist|arm|leg))/i, severity: 0.85, confidence: 0.75 },
  { pattern: /\b(want|going)\s+to\s+(die|end\s+it|kill\s+myself)/i, severity: 0.90, confidence: 0.80 },
  { pattern: /\bsuicid(e|al)\b/i, severity: 0.70, confidence: 0.60 }, // Lower confidence - could be discussion
  { pattern: /\bself[- ]harm/i, severity: 0.75, confidence: 0.65 },
  { pattern: /\bkill\s+myself\b/i, severity: 0.95, confidence: 0.85 },
];

// =============================================================================
// CLEAN TEXT INDICATORS (for high-confidence ALLOW)
// =============================================================================

function hasCleanIndicators(text: string): boolean {
  const lowerText = text.toLowerCase();
  
  // Very short, simple text
  if (text.length < 20 && !/[!@#$%^&*]/.test(text)) {
    return true;
  }
  
  // Common safe patterns
  const safePatterns = [
    /^(hi|hello|hey|thanks|thank you|please|okay|ok|yes|no|sure|good|great|nice|cool)\b/i,
    /^(i think|i believe|in my opinion|maybe|perhaps)\b/i,
    /\b(have a (nice|good|great) day)\b/i,
  ];
  
  for (const pattern of safePatterns) {
    if (pattern.test(lowerText)) {
      return true;
    }
  }
  
  return false;
}

// =============================================================================
// LOCAL PROVIDER RESULT WITH CONFIDENCE METADATA
// =============================================================================

export interface LocalProviderResult extends ProviderResult {
  localMeta: {
    hasObfuscation: boolean;
    detectedTerms: string[];
    cleanIndicators: boolean;
    contextApplied: boolean;
    rawSeverity: number;        // Before context adjustment
    adjustedSeverity: number;   // After context adjustment
  };
}

// =============================================================================
// LOCAL PROVIDER
// =============================================================================

export class LocalProvider implements ModerationProvider {
  readonly name = 'local';
  readonly displayName = 'Local Pattern Matching';
  readonly requiresApiKey = false;
  
  constructor(_config: ProviderConfig = {}) {
    // No config needed for local provider
  }
  
  isAvailable(): boolean {
    return true; // Always available
  }
  
  getInfo(): ProviderInfo {
    return {
      name: this.name,
      displayName: this.displayName,
      available: true,
      requiresApiKey: false,
      categories: ['hate_speech', 'harassment', 'profanity', 'threats', 'self_harm', 'violence'],
      pricing: {
        model: 'free',
        details: 'No API calls, runs locally (~3ms)',
      },
    };
  }
  
  async analyze(text: string): Promise<LocalProviderResult> {
    const startTime = performance.now();
    
    // Normalize text first
    const { normalized } = normalizer.normalize(text);
    const hasObfuscation = normalizer.hasObfuscation(text);
    
    // Initialize
    const categories: CategoryScores = {};
    const detectedTerms: string[] = [];
    let maxSeverity = 0;
    let maxConfidence = 0;
    let triggeredHighPriority = false;
    
    // Check severe slurs (high confidence)
    for (const { pattern, categories: cats, severity, confidence } of SEVERE_SLURS) {
      const match = pattern.exec(normalized);
      if (match) {
        for (const cat of cats) {
          categories[cat] = Math.max(categories[cat] || 0, severity);
        }
        maxSeverity = Math.max(maxSeverity, severity);
        maxConfidence = Math.max(maxConfidence, confidence);
        detectedTerms.push(match[0]);
      }
    }
    
    // Check profanity (medium confidence)
    for (const { pattern, severity, confidence } of PROFANITY_PATTERNS) {
      const match = pattern.exec(normalized);
      if (match) {
        categories.profanity = Math.max(categories.profanity || 0, severity);
        maxSeverity = Math.max(maxSeverity, severity);
        // Only update confidence if higher
        if (confidence > maxConfidence && maxSeverity < 0.7) {
          maxConfidence = confidence;
        }
        detectedTerms.push(match[0]);
      }
    }
    
    // Check threats (high priority - flag for API escalation)
    for (const { pattern, severity, confidence, categories: cats } of THREAT_PATTERNS) {
      const match = pattern.exec(normalized);
      if (match) {
        for (const cat of cats) {
          categories[cat] = Math.max(categories[cat] || 0, severity);
        }
        maxSeverity = Math.max(maxSeverity, severity);
        maxConfidence = Math.max(maxConfidence, confidence);
        detectedTerms.push(match[0]);
        triggeredHighPriority = true;
      }
    }
    
    // Check self-harm (high priority - flag for API escalation)
    for (const { pattern, severity, confidence } of SELF_HARM_PATTERNS) {
      const match = pattern.exec(normalized);
      if (match) {
        categories.self_harm = Math.max(categories.self_harm || 0, severity);
        maxSeverity = Math.max(maxSeverity, severity);
        maxConfidence = Math.max(maxConfidence, confidence);
        detectedTerms.push(match[0]);
        triggeredHighPriority = true;
      }
    }
    
    // Check for clean indicators (high confidence ALLOW)
    const cleanIndicators = hasCleanIndicators(text) && detectedTerms.length === 0;
    if (cleanIndicators) {
      maxConfidence = 0.90; // High confidence it's clean
    }
    
    // Default confidence for no-match cases
    if (maxConfidence === 0) {
      // Nothing detected - moderate confidence it's clean
      // (could still have subtle harassment that patterns miss)
      maxConfidence = cleanIndicators ? 0.90 : 0.50;
    }
    
    // Apply context reduction
    const rawSeverity = maxSeverity;
    const contextFactors = contextEvaluator.evaluate(text);
    const harmReduction = contextEvaluator.calculateHarmReduction(contextFactors);
    const adjustedSeverity = Math.min(maxSeverity * harmReduction, 1.0);
    
    // Reduce confidence if context significantly changed the severity
    // (means context matters a lot for this case - might want API verification)
    if (harmReduction < 0.5 && maxSeverity > 0.5) {
      maxConfidence *= 0.7; // Less confident when context plays big role
    }
    
    const latencyMs = performance.now() - startTime;
    
    return {
      provider: this.name,
      flagged: adjustedSeverity > 0.3,
      confidence: maxConfidence,
      categories,
      rawResponse: { 
        normalized, 
        contextFactors, 
        harmReduction,
        detectedTerms,
        triggeredHighPriority,
      },
      latencyMs,
      localMeta: {
        hasObfuscation,
        detectedTerms,
        cleanIndicators,
        contextApplied: harmReduction < 1.0,
        rawSeverity,
        adjustedSeverity,
      },
    };
  }
}
