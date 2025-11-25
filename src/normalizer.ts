/**
 * Text Normalizer
 * 
 * Handles obfuscation techniques:
 * - Homoglyphs (Cyrillic а → Latin a)
 * - Leetspeak (1 → i, 3 → e, 0 → o)
 * - Zero-width characters
 * - Spacing tricks (f u c k, f.u.c.k)
 * - Phonetic variants (future: Soundex/Metaphone)
 */

// =============================================================================
// HOMOGLYPH MAP
// Unicode characters that look like ASCII letters
// =============================================================================

const HOMOGLYPHS: Record<string, string> = {
  // Cyrillic → Latin
  'а': 'a', 'А': 'A',
  'в': 'b', 'В': 'B',
  'с': 'c', 'С': 'C',
  'е': 'e', 'Е': 'E',
  'н': 'h', 'Н': 'H',
  'і': 'i', 'І': 'I',
  'ї': 'i',
  'к': 'k', 'К': 'K',
  'м': 'm', 'М': 'M',
  'о': 'o', 'О': 'O',
  'р': 'p', 'Р': 'P',
  'ѕ': 's',
  'т': 't', 'Т': 'T',
  'у': 'y', 'У': 'Y',
  'х': 'x', 'Х': 'X',
  
  // Greek → Latin
  'α': 'a', 'Α': 'A',
  'β': 'b', 'Β': 'B',
  'ε': 'e', 'Ε': 'E',
  'η': 'n',
  'ι': 'i', 'Ι': 'I',
  'κ': 'k', 'Κ': 'K',
  'ν': 'v',
  'ο': 'o', 'Ο': 'O',
  'ρ': 'p', 'Ρ': 'P',
  'τ': 't', 'Τ': 'T',
  'υ': 'u', 'Υ': 'Y',
  'χ': 'x', 'Χ': 'X',
  
  // Mathematical/Fancy Unicode
  '𝐚': 'a', '𝐛': 'b', '𝐜': 'c', '𝐝': 'd', '𝐞': 'e',
  '𝐟': 'f', '𝐠': 'g', '𝐡': 'h', '𝐢': 'i', '𝐣': 'j',
  '𝐤': 'k', '𝐥': 'l', '𝐦': 'm', '𝐧': 'n', '𝐨': 'o',
  '𝐩': 'p', '𝐪': 'q', '𝐫': 'r', '𝐬': 's', '𝐭': 't',
  '𝐮': 'u', '𝐯': 'v', '𝐰': 'w', '𝐱': 'x', '𝐲': 'y', '𝐳': 'z',
  
  // Fullwidth characters
  'ａ': 'a', 'ｂ': 'b', 'ｃ': 'c', 'ｄ': 'd', 'ｅ': 'e',
  'ｆ': 'f', 'ｇ': 'g', 'ｈ': 'h', 'ｉ': 'i', 'ｊ': 'j',
  'ｋ': 'k', 'ｌ': 'l', 'ｍ': 'm', 'ｎ': 'n', 'ｏ': 'o',
  'ｐ': 'p', 'ｑ': 'q', 'ｒ': 'r', 'ｓ': 's', 'ｔ': 't',
  'ｕ': 'u', 'ｖ': 'v', 'ｗ': 'w', 'ｘ': 'x', 'ｙ': 'y', 'ｚ': 'z',
  
  // Circled letters
  'ⓐ': 'a', 'ⓑ': 'b', 'ⓒ': 'c', 'ⓓ': 'd', 'ⓔ': 'e',
  'ⓕ': 'f', 'ⓖ': 'g', 'ⓗ': 'h', 'ⓘ': 'i', 'ⓙ': 'j',
  'ⓚ': 'k', 'ⓛ': 'l', 'ⓜ': 'm', 'ⓝ': 'n', 'ⓞ': 'o',
  'ⓟ': 'p', 'ⓠ': 'q', 'ⓡ': 'r', 'ⓢ': 's', 'ⓣ': 't',
  'ⓤ': 'u', 'ⓥ': 'v', 'ⓦ': 'w', 'ⓧ': 'x', 'ⓨ': 'y', 'ⓩ': 'z',
  
  // Small caps
  'ᴀ': 'a', 'ʙ': 'b', 'ᴄ': 'c', 'ᴅ': 'd', 'ᴇ': 'e',
  'ꜰ': 'f', 'ɢ': 'g', 'ʜ': 'h', 'ɪ': 'i', 'ᴊ': 'j',
  'ᴋ': 'k', 'ʟ': 'l', 'ᴍ': 'm', 'ɴ': 'n', 'ᴏ': 'o',
  'ᴘ': 'p', 'ǫ': 'q', 'ʀ': 'r', 's': 's', 'ᴛ': 't',
  'ᴜ': 'u', 'ᴠ': 'v', 'ᴡ': 'w', 'x': 'x', 'ʏ': 'y', 'ᴢ': 'z',
  
  // Other common substitutes
  'ℓ': 'l',
  '∂': 'd',
  '№': 'no',
  '℮': 'e',
  'ⅰ': 'i', 'ⅱ': 'ii', 'ⅲ': 'iii',
  '†': 't',
  'ƒ': 'f',
};

// =============================================================================
// LEETSPEAK MAP
// Number and symbol substitutions
// =============================================================================

const LEETSPEAK: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '2': 'z',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '6': 'g',
  '7': 't',
  '8': 'b',
  '9': 'g',
  '@': 'a',
  '$': 's',
  '!': 'i',
  '|': 'i',
  '+': 't',
  '€': 'e',
  '£': 'l',
  '¥': 'y',
  '(': 'c',
  ')': 'c', // context dependent
  '[': 'c',
  '{': 'c',
  '<': 'c',
  '>': 'c', // context dependent
  '&': 'and',
  '\\': 'l',
  '/': 'l',
  '^': 'a',
  '*': 'a', // often used as vowel placeholder
  '~': 'n',
  '#': 'h',
  '%': 'x',
};

// =============================================================================
// ZERO-WIDTH AND INVISIBLE CHARACTERS
// =============================================================================

const ZERO_WIDTH_CHARS = [
  '\u200B', // Zero-width space
  '\u200C', // Zero-width non-joiner
  '\u200D', // Zero-width joiner
  '\u200E', // Left-to-right mark
  '\u200F', // Right-to-left mark
  '\u2060', // Word joiner
  '\u2061', // Function application
  '\u2062', // Invisible times
  '\u2063', // Invisible separator
  '\u2064', // Invisible plus
  '\uFEFF', // BOM / Zero-width no-break space
  '\u00AD', // Soft hyphen
  '\u034F', // Combining grapheme joiner
  '\u061C', // Arabic letter mark
  '\u115F', // Hangul choseong filler
  '\u1160', // Hangul jungseong filler
  '\u17B4', // Khmer vowel inherent aq
  '\u17B5', // Khmer vowel inherent aa
  '\u180E', // Mongolian vowel separator
  '\u3164', // Hangul filler
  '\uFFA0', // Halfwidth hangul filler
];

const ZERO_WIDTH_REGEX = new RegExp(`[${ZERO_WIDTH_CHARS.join('')}]`, 'g');

// =============================================================================
// SPACING PATTERNS
// Detect and collapse f.u.c.k, f u c k, f-u-c-k patterns
// =============================================================================

// Regex to find single chars separated by consistent delimiters
const SPACED_WORD_PATTERN = /\b([a-zA-Z])(?:[\s.\-_*]+([a-zA-Z])){2,}\b/g;

function collapseSpacedWords(text: string): string {
  // Match patterns like "f u c k" or "f.u.c.k" or "f-u-c-k"
  return text.replace(/\b([a-zA-Z])([\s.\-_*]+[a-zA-Z]){2,}\b/g, (match) => {
    // Extract just the letters
    return match.replace(/[\s.\-_*]+/g, '');
  });
}

// =============================================================================
// REPEATED CHARACTER NORMALIZATION
// Collapse "fuuuuuck" → "fuck"
// =============================================================================

function normalizeRepeatedChars(text: string): string {
  // Collapse 3+ repeated chars to 2 (keeps intentional doubles like "book")
  return text.replace(/(.)\1{2,}/g, '$1$1');
}

// =============================================================================
// MAIN NORMALIZER CLASS
// =============================================================================

export interface NormalizationResult {
  normalized: string;
  original: string;
  changes: NormalizationChange[];
}

export interface NormalizationChange {
  type: 'homoglyph' | 'leetspeak' | 'zero-width' | 'spacing' | 'repeated';
  original: string;
  normalized: string;
  position: number;
}

export class TextNormalizer {
  private homoglyphMap: Map<string, string>;
  private leetspeakMap: Map<string, string>;
  
  constructor() {
    this.homoglyphMap = new Map(Object.entries(HOMOGLYPHS));
    this.leetspeakMap = new Map(Object.entries(LEETSPEAK));
  }
  
  /**
   * Full normalization pipeline
   */
  normalize(text: string, options: {
    homoglyphs?: boolean;
    leetspeak?: boolean;
    zeroWidth?: boolean;
    spacing?: boolean;
    repeated?: boolean;
    lowercase?: boolean;
  } = {}): NormalizationResult {
    const opts = {
      homoglyphs: true,
      leetspeak: true,
      zeroWidth: true,
      spacing: true,
      repeated: true,
      lowercase: true,
      ...options,
    };
    
    const changes: NormalizationChange[] = [];
    let result = text;
    
    // Order matters: zero-width first, then homoglyphs, then leetspeak
    if (opts.zeroWidth) {
      result = this.removeZeroWidth(result);
    }
    
    if (opts.homoglyphs) {
      result = this.normalizeHomoglyphs(result);
    }
    
    if (opts.leetspeak) {
      result = this.normalizeLeetspeak(result);
    }
    
    if (opts.spacing) {
      result = collapseSpacedWords(result);
    }
    
    if (opts.repeated) {
      result = normalizeRepeatedChars(result);
    }
    
    if (opts.lowercase) {
      result = result.toLowerCase();
    }
    
    return {
      normalized: result,
      original: text,
      changes, // TODO: track individual changes for debugging
    };
  }
  
  /**
   * Remove zero-width and invisible characters
   */
  removeZeroWidth(text: string): string {
    return text.replace(ZERO_WIDTH_REGEX, '');
  }
  
  /**
   * Convert homoglyphs (lookalike Unicode) to ASCII
   */
  normalizeHomoglyphs(text: string): string {
    let result = '';
    for (const char of text) {
      result += this.homoglyphMap.get(char) ?? char;
    }
    return result;
  }
  
  /**
   * Convert leetspeak numbers/symbols to letters
   */
  normalizeLeetspeak(text: string): string {
    let result = '';
    for (const char of text) {
      result += this.leetspeakMap.get(char) ?? char;
    }
    return result;
  }
  
  /**
   * Check if text contains obfuscation
   */
  hasObfuscation(text: string): boolean {
    // Check for homoglyphs
    for (const char of text) {
      if (this.homoglyphMap.has(char)) return true;
    }
    
    // Check for leetspeak in word context
    if (/\b\w*[0-9@$!|+]\w*\b/.test(text)) return true;
    
    // Check for zero-width chars
    if (ZERO_WIDTH_REGEX.test(text)) return true;
    
    // Check for spaced-out words
    if (/\b[a-zA-Z][\s.\-_*]+[a-zA-Z][\s.\-_*]+[a-zA-Z]/.test(text)) return true;
    
    return false;
  }
  
  /**
   * Add custom homoglyph mappings
   */
  addHomoglyphs(mappings: Record<string, string>): void {
    for (const [from, to] of Object.entries(mappings)) {
      this.homoglyphMap.set(from, to);
    }
  }
  
  /**
   * Add custom leetspeak mappings
   */
  addLeetspeak(mappings: Record<string, string>): void {
    for (const [from, to] of Object.entries(mappings)) {
      this.leetspeakMap.set(from, to);
    }
  }
}

// Export singleton for convenience
export const normalizer = new TextNormalizer();

