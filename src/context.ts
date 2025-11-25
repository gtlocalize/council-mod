/**
 * Context Evaluator
 * 
 * Analyzes the context around flagged terms to determine:
 * - Intent (attacking, discussing, quoting, reclaiming)
 * - Target (person, group, self, abstract)
 * - Mitigating factors (educational, quoted speech, reclamation)
 */

import { ContextFactors, Intent, Target } from './types';

// =============================================================================
// QUOTE DETECTION PATTERNS
// =============================================================================

const QUOTE_PATTERNS = [
  // Direct quotes
  /[""]([^""]+)[""]/g,
  /[''']([^''']+)[''']/g,
  /"([^"]+)"/g,
  /'([^']+)'/g,
  
  // Reported speech indicators
  /\b(he|she|they|someone|the person)\s+(said|called|yelled|screamed|wrote|texted|messaged|told)\s+/i,
  /\b(called me|told me|said to me|yelled at me)\s+/i,
  /\bwas called\s+/i,
  /\bi was told\s+/i,
  /\bquote[sd]?\s*:?\s*/i,
];

// =============================================================================
// EDUCATIONAL/ACADEMIC PATTERNS
// =============================================================================

const EDUCATIONAL_PATTERNS = [
  /\b(historically|etymology|linguistic|academic|scholarly)\b/i,
  /\b(the word|the term|the phrase|the slur)\s+["']?\w+["']?\s+(means|refers|originated|comes from)/i,
  /\b(defined as|definition of|meaning of)\b/i,
  /\b(in the context of|when discussing|when studying)\b/i,
  /\b(research|study|analysis|paper|article|book)\s+(on|about|regarding)\b/i,
  /\b(history of|origin of|evolution of)\b/i,
];

// =============================================================================
// RECLAMATION PATTERNS
// Indicators of in-group use or reclamation
// =============================================================================

const RECLAMATION_INDICATORS = [
  /\b(as a|being a|i'm a|i am a|we as)\s+(black|gay|queer|trans|disabled|jewish)\b/i,
  /\b(my|our)\s+(community|people|culture|identity)\b/i,
  /\b(we|us)\s+(can say|use the word|reclaim)\b/i,
  /\bin (our|my) (community|culture)\b/i,
  /\breclaim(ing|ed)?\b/i,
  /\bown(ing|ed)?\s+(the word|it|that)\b/i,
];

// =============================================================================
// SELF-REFERENCE PATTERNS
// =============================================================================

const SELF_REFERENCE_PATTERNS = [
  /\b(i am|i'm|i was|i've been|i feel like)\s+(such )?(a|an)?\s*/i,
  /\b(myself|me)\b/i,
  /\bi\s+(called|call)\s+myself\b/i,
];

// =============================================================================
// ATTACK INDICATORS
// Direct targeting of another person/group
// =============================================================================

const ATTACK_INDICATORS = [
  /\b(you|you're|your|they|they're|their|those)\s+(are|is|a|an)?\s*/i,
  /\b(all|every|typical)\s+\w+s?\s+(are|is)\b/i,
  /\b(go back|get out|leave|die|kill yourself)\b/i,
  /\b(should be|deserve to|need to)\s+(die|suffer|be killed|be hurt)\b/i,
  /\b(hate|despise|loathe)\s+(you|them|all)\b/i,
];

// =============================================================================
// SENTIMENT KEYWORDS
// =============================================================================

const POSITIVE_INDICATORS = [
  'love', 'proud', 'beautiful', 'amazing', 'wonderful', 'great', 'awesome',
  'support', 'celebrate', 'embrace', 'empower', 'uplift', 'inspiring',
];

const NEGATIVE_INDICATORS = [
  'hate', 'despise', 'disgusting', 'terrible', 'horrible', 'awful', 'vile',
  'die', 'kill', 'destroy', 'eliminate', 'remove', 'eradicate', 'stupid',
  'ugly', 'worthless', 'pathetic', 'trash', 'garbage', 'scum',
];

// =============================================================================
// CONTEXT EVALUATOR CLASS
// =============================================================================

export class ContextEvaluator {
  /**
   * Analyze the full context of a piece of text
   */
  evaluate(text: string, flaggedTermPosition?: { start: number; end: number }): ContextFactors {
    const lowerText = text.toLowerCase();
    
    const isQuoted = this.detectQuotedSpeech(text);
    const isEducational = this.detectEducationalContext(text);
    const isReclamation = this.detectReclamation(text);
    const isSelfReferential = this.detectSelfReference(text);
    
    const intent = this.classifyIntent(text, {
      isQuoted,
      isEducational,
      isReclamation,
      isSelfReferential,
    });
    
    const target = this.identifyTarget(text);
    const sentiment = this.analyzeSentiment(text);
    
    return {
      intent,
      target,
      isReclamation,
      isEducational,
      isQuoted,
      isSelfReferential,
      sentiment,
    };
  }
  
  /**
   * Detect if the flagged content is within quoted/reported speech
   */
  detectQuotedSpeech(text: string): boolean {
    for (const pattern of QUOTE_PATTERNS) {
      if (pattern.test(text)) {
        return true;
      }
      // Reset regex state for global patterns
      if (pattern.global) {
        pattern.lastIndex = 0;
      }
    }
    return false;
  }
  
  /**
   * Detect educational/academic context
   */
  detectEducationalContext(text: string): boolean {
    for (const pattern of EDUCATIONAL_PATTERNS) {
      if (pattern.test(text)) {
        return true;
      }
    }
    return false;
  }
  
  /**
   * Detect potential reclamation use
   */
  detectReclamation(text: string): boolean {
    for (const pattern of RECLAMATION_INDICATORS) {
      if (pattern.test(text)) {
        return true;
      }
    }
    return false;
  }
  
  /**
   * Detect self-referential use
   */
  detectSelfReference(text: string): boolean {
    for (const pattern of SELF_REFERENCE_PATTERNS) {
      if (pattern.test(text)) {
        return true;
      }
    }
    return false;
  }
  
  /**
   * Classify the intent behind the usage
   */
  classifyIntent(
    text: string,
    factors: { isQuoted: boolean; isEducational: boolean; isReclamation: boolean; isSelfReferential: boolean }
  ): Intent {
    // Priority order: reclaim > educational > quote > attack > discuss
    if (factors.isReclamation) return 'reclaim';
    if (factors.isEducational) return 'educational';
    if (factors.isQuoted) return 'quote';
    
    // Check for attack indicators
    for (const pattern of ATTACK_INDICATORS) {
      if (pattern.test(text)) {
        return 'attack';
      }
    }
    
    // Default to discuss if no strong signals
    return 'discuss';
  }
  
  /**
   * Identify the target of the content
   */
  identifyTarget(text: string): Target {
    const lowerText = text.toLowerCase();
    
    // Check for self-targeting first
    if (/\b(i|me|myself|i'm|i am)\b/.test(lowerText)) {
      if (/\b(i'm|i am|i feel|myself)\s+(a|an|such|like|so)?\s*\w*\b/.test(lowerText)) {
        return 'self';
      }
    }
    
    // Check for direct person targeting (you)
    if (/\b(you|you're|your|you are)\b/.test(lowerText)) {
      return 'person';
    }
    
    // Check for group targeting
    if (/\b(all|every|those|these|they|them|their)\s+\w+s?\b/.test(lowerText)) {
      return 'group';
    }
    
    // Check for abstract discussion
    if (/\b(the word|the term|the concept|in general|generally|typically)\b/.test(lowerText)) {
      return 'abstract';
    }
    
    return 'none';
  }
  
  /**
   * Basic sentiment analysis
   */
  analyzeSentiment(text: string): 'positive' | 'negative' | 'neutral' {
    const lowerText = text.toLowerCase();
    
    let positiveScore = 0;
    let negativeScore = 0;
    
    for (const word of POSITIVE_INDICATORS) {
      if (lowerText.includes(word)) positiveScore++;
    }
    
    for (const word of NEGATIVE_INDICATORS) {
      if (lowerText.includes(word)) negativeScore++;
    }
    
    if (negativeScore > positiveScore + 1) return 'negative';
    if (positiveScore > negativeScore + 1) return 'positive';
    return 'neutral';
  }
  
  /**
   * Calculate a harm reduction factor based on context
   * Returns 0.0 - 1.0 where lower = more reduction in harm score
   */
  calculateHarmReduction(factors: ContextFactors): number {
    let reduction = 1.0; // Start with no reduction
    
    // Reclamation: significant reduction
    if (factors.isReclamation) {
      reduction *= 0.2;
    }
    
    // Educational: significant reduction
    if (factors.isEducational) {
      reduction *= 0.3;
    }
    
    // Quoted speech: moderate reduction
    if (factors.isQuoted) {
      reduction *= 0.5;
    }
    
    // Self-referential: moderate reduction
    if (factors.isSelfReferential && factors.target === 'self') {
      reduction *= 0.6;
    }
    
    // Intent-based adjustments
    switch (factors.intent) {
      case 'reclaim':
        reduction *= 0.2;
        break;
      case 'educational':
        reduction *= 0.3;
        break;
      case 'quote':
        reduction *= 0.5;
        break;
      case 'discuss':
        reduction *= 0.7;
        break;
      case 'attack':
        reduction *= 1.2; // Actually increase harm for attacks
        break;
    }
    
    // Target-based adjustments
    if (factors.target === 'person') {
      reduction *= 1.3; // Increase for direct targeting
    } else if (factors.target === 'group') {
      reduction *= 1.2;
    }
    
    // Negative sentiment increases harm
    if (factors.sentiment === 'negative') {
      reduction *= 1.2;
    } else if (factors.sentiment === 'positive') {
      reduction *= 0.8;
    }
    
    // Clamp to reasonable range
    return Math.min(Math.max(reduction, 0.1), 2.0);
  }
}

// Export singleton
export const contextEvaluator = new ContextEvaluator();

