/**
 * Language Detection
 * 
 * Detects script type and language characteristics for routing decisions.
 * Non-Latin scripts should skip fast-path and go directly to API.
 */

// =============================================================================
// SCRIPT DETECTION
// =============================================================================

/**
 * Unicode ranges for different scripts
 */
const SCRIPT_RANGES = {
  // CJK (Chinese, Japanese, Korean)
  cjk: [
    [0x4E00, 0x9FFF],   // CJK Unified Ideographs
    [0x3400, 0x4DBF],   // CJK Unified Ideographs Extension A
    [0x20000, 0x2A6DF], // CJK Unified Ideographs Extension B
    [0x2A700, 0x2B73F], // CJK Unified Ideographs Extension C
    [0x2B740, 0x2B81F], // CJK Unified Ideographs Extension D
    [0xF900, 0xFAFF],   // CJK Compatibility Ideographs
    [0x3000, 0x303F],   // CJK Symbols and Punctuation
  ],
  
  // Japanese-specific
  hiragana: [[0x3040, 0x309F]],
  katakana: [[0x30A0, 0x30FF], [0x31F0, 0x31FF]],
  
  // Korean-specific
  hangul: [
    [0xAC00, 0xD7AF],   // Hangul Syllables
    [0x1100, 0x11FF],   // Hangul Jamo
    [0x3130, 0x318F],   // Hangul Compatibility Jamo
  ],
  
  // Cyrillic
  cyrillic: [[0x0400, 0x04FF], [0x0500, 0x052F]],
  
  // Arabic
  arabic: [[0x0600, 0x06FF], [0x0750, 0x077F], [0x08A0, 0x08FF]],
  
  // Hebrew
  hebrew: [[0x0590, 0x05FF]],
  
  // Thai
  thai: [[0x0E00, 0x0E7F]],
  
  // Devanagari (Hindi, Sanskrit, etc.)
  devanagari: [[0x0900, 0x097F]],
  
  // Greek
  greek: [[0x0370, 0x03FF]],
  
  // Latin (including extended)
  latin: [
    [0x0000, 0x007F],   // Basic Latin
    [0x0080, 0x00FF],   // Latin-1 Supplement
    [0x0100, 0x017F],   // Latin Extended-A
    [0x0180, 0x024F],   // Latin Extended-B
    [0x1E00, 0x1EFF],   // Latin Extended Additional
  ],
};

export type ScriptType = 
  | 'latin' 
  | 'cjk' 
  | 'cyrillic' 
  | 'arabic' 
  | 'hebrew' 
  | 'thai' 
  | 'devanagari' 
  | 'greek'
  | 'mixed'
  | 'unknown';

/**
 * Check if a code point falls within any of the given ranges
 */
function inRanges(codePoint: number, ranges: number[][]): boolean {
  return ranges.some(([start, end]) => codePoint >= start && codePoint <= end);
}

/**
 * Detect the primary script used in text
 */
export function detectScript(text: string): ScriptType {
  const counts: Record<string, number> = {
    latin: 0,
    cjk: 0,
    cyrillic: 0,
    arabic: 0,
    hebrew: 0,
    thai: 0,
    devanagari: 0,
    greek: 0,
  };
  
  let totalLetters = 0;
  
  for (const char of text) {
    const cp = char.codePointAt(0);
    if (cp === undefined) continue;
    
    // Skip whitespace, numbers, common punctuation
    if (cp <= 0x40 || (cp >= 0x5B && cp <= 0x60) || (cp >= 0x7B && cp <= 0x7F)) {
      continue;
    }
    
    totalLetters++;
    
    if (inRanges(cp, SCRIPT_RANGES.latin)) {
      counts.latin++;
    } else if (inRanges(cp, SCRIPT_RANGES.cjk) || 
               inRanges(cp, SCRIPT_RANGES.hiragana) || 
               inRanges(cp, SCRIPT_RANGES.katakana) ||
               inRanges(cp, SCRIPT_RANGES.hangul)) {
      counts.cjk++;
    } else if (inRanges(cp, SCRIPT_RANGES.cyrillic)) {
      counts.cyrillic++;
    } else if (inRanges(cp, SCRIPT_RANGES.arabic)) {
      counts.arabic++;
    } else if (inRanges(cp, SCRIPT_RANGES.hebrew)) {
      counts.hebrew++;
    } else if (inRanges(cp, SCRIPT_RANGES.thai)) {
      counts.thai++;
    } else if (inRanges(cp, SCRIPT_RANGES.devanagari)) {
      counts.devanagari++;
    } else if (inRanges(cp, SCRIPT_RANGES.greek)) {
      counts.greek++;
    }
  }
  
  if (totalLetters === 0) return 'unknown';
  
  // Find dominant script
  const entries = Object.entries(counts).sort(([, a], [, b]) => b - a);
  const [topScript, topCount] = entries[0];
  const [secondScript, secondCount] = entries[1] || ['', 0];
  
  // If dominant script is >80% of text, return it
  if (topCount / totalLetters > 0.8) {
    return topScript as ScriptType;
  }
  
  // If two scripts are both significant, it's mixed
  if (topCount > 0 && secondCount > 0 && secondCount / totalLetters > 0.2) {
    return 'mixed';
  }
  
  return topScript as ScriptType;
}

/**
 * Check if text is primarily Latin script
 */
export function isLatinScript(text: string): boolean {
  const script = detectScript(text);
  return script === 'latin';
}

/**
 * Check if text contains non-Latin characters that need special handling
 */
export function hasNonLatinContent(text: string): boolean {
  const script = detectScript(text);
  return script !== 'latin' && script !== 'unknown';
}

/**
 * Language detection result with routing recommendation
 */
export interface LanguageAnalysis {
  script: ScriptType;
  isLatin: boolean;
  shouldSkipFastPath: boolean;
  reason: string;
}

/**
 * Analyze text and determine routing
 */
export function analyzeLanguage(text: string): LanguageAnalysis {
  const script = detectScript(text);
  const isLatin = script === 'latin';
  
  // Skip fast-path for non-Latin scripts - our patterns don't cover them
  const shouldSkipFastPath = !isLatin && script !== 'unknown';
  
  let reason: string;
  if (isLatin) {
    reason = 'Latin script detected, fast-path eligible';
  } else if (script === 'unknown') {
    reason = 'No alphabetic content detected';
  } else {
    reason = `${script} script detected, skipping fast-path for API analysis`;
  }
  
  return {
    script,
    isLatin,
    shouldSkipFastPath,
    reason,
  };
}

