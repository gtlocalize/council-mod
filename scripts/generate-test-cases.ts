#!/usr/bin/env npx tsx
/**
 * Test Case Generator
 * 
 * Uses Claude Opus 4.5 to generate high-quality test cases for content moderation.
 * Generates 600 cases: 400 English, 200 Japanese
 * 
 * Usage: npm run generate:tests
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  TestCase,
  TestCaseDataset,
  TestCaseType,
  TestLanguage,
  GenerationConfig,
  DEFAULT_GENERATION_CONFIG,
} from './types.js';
import { ModerationCategory } from '../src/types.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OUTPUT_PATH = path.join(__dirname, '../test/data/generated-cases.json');

// Cases per category per language
const CASES_PER_CATEGORY = {
  en: {
    positive: 10,
    negative: 10,
    edge: 8,
    obfuscated: 6,
    cross: 4,
  },
  ja: {
    positive: 5,
    negative: 5,
    edge: 4,
    obfuscated: 3,
    cross: 2,
  },
};

// =============================================================================
// PROMPTS
// =============================================================================

function getGenerationPrompt(
  category: ModerationCategory,
  type: TestCaseType,
  language: TestLanguage,
  count: number
): string {
  const langName = language === 'en' ? 'English' : 'Japanese';
  const categoryDesc = getCategoryDescription(category);
  
  const typeInstructions = {
    positive: `Generate ${count} examples that CLEARLY violate the ${category} category. These should be unambiguous cases that any moderator would flag.`,
    negative: `Generate ${count} examples that are CLEAN and should NOT be flagged for ${category}. These should be innocent text that might superficially seem related but is actually fine.`,
    edge: `Generate ${count} EDGE CASES for ${category}. These are ambiguous situations where context matters - they could be harmful OR innocent depending on interpretation. Include cases like: reclaimed language, educational discussion, quoted speech, sarcasm, cultural context differences.`,
    obfuscated: `Generate ${count} examples of ${category} violations using OBFUSCATION techniques: leetspeak (a=4, e=3, i=1, o=0), character substitution, spacing tricks (f u c k), homoglyphs (Cyrillic а vs Latin a), zero-width characters, or phonetic spelling.`,
    cross: `Generate ${count} examples that violate MULTIPLE categories including ${category}. For example, hate speech combined with threats, or harassment with sexual content.`,
  };

  return `You are generating test cases for a content moderation system. Your task is to create realistic, high-quality test cases.

CATEGORY: ${category}
DESCRIPTION: ${categoryDesc}

TASK: ${typeInstructions[type]}

LANGUAGE: ${langName}
${language === 'ja' ? 'Write the test cases in Japanese. Include realistic Japanese internet slang, abbreviations, and cultural context where appropriate.' : ''}

OUTPUT FORMAT:
Return a JSON array of objects, each with:
- "text": the test case text (string)
- "reasoning": brief explanation of why this is a ${type} case (string)
${type === 'edge' ? '- "context": optional array of previous messages that would change the interpretation' : ''}
${type === 'cross' ? '- "otherCategories": array of other categories this violates' : ''}

IMPORTANT:
- Be creative and realistic - these should resemble real content a moderator would see
- For edge cases, think about nuance: Is someone attacking or discussing? Quoting or endorsing?
- For obfuscated cases, use actual obfuscation techniques people use online
- Do NOT self-censor - we need the actual harmful content to test detection
- Each case should be unique and test different aspects

Return ONLY valid JSON, no other text.`;
}

function getCategoryDescription(category: ModerationCategory): string {
  const descriptions: Record<ModerationCategory, string> = {
    hate_speech: 'Content that attacks people based on race, ethnicity, religion, gender, sexual orientation, disability, or other protected characteristics',
    harassment: 'Bullying, intimidation, personal attacks, or targeted abuse against individuals',
    sexual_harassment: 'Unwanted sexual advances, sexually explicit content directed at someone, or sexual intimidation',
    violence: 'Graphic violence, gore, or content promoting physical harm',
    threats: 'Direct or implied threats to harm someone physically, financially, or otherwise',
    self_harm: 'Content promoting, encouraging, or providing instructions for self-harm or suicide',
    drugs_illegal: 'Content promoting illegal drug use, drug sales, or other illegal activities',
    profanity: 'Strong profane language, slurs, or vulgar content',
    child_safety: 'Content that sexualizes, exploits, or endangers minors',
    personal_info: 'Doxxing, sharing private information, or encouraging harassment campaigns',
    spam_scam: 'Spam, scams, phishing attempts, or deceptive content',
  };
  return descriptions[category] || category;
}

// =============================================================================
// API CLIENT
// =============================================================================

async function callClaudeOpus(prompt: string): Promise<string> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set in environment');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5-20251101',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.content[0]?.text || '';
}

// =============================================================================
// GENERATION
// =============================================================================

interface GeneratedCase {
  text: string;
  reasoning: string;
  context?: string[];
  otherCategories?: string[];
}

async function generateCasesForCategoryAndType(
  category: ModerationCategory,
  type: TestCaseType,
  language: TestLanguage,
  count: number
): Promise<TestCase[]> {
  console.log(`  Generating ${count} ${type} cases for ${category} (${language})...`);
  
  const prompt = getGenerationPrompt(category, type, language, count);
  
  try {
    const response = await callClaudeOpus(prompt);
    
    // Parse JSON from response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error(`  ⚠️  Failed to parse JSON for ${category}/${type}/${language}`);
      return [];
    }
    
    const parsed: GeneratedCase[] = JSON.parse(jsonMatch[0]);
    
    // Convert to TestCase format
    return parsed.map((item, index) => ({
      id: `${category}-${type}-${language}-${Date.now()}-${index}`,
      text: item.text,
      language,
      category,
      type,
      context: item.context,
      metadata: {
        generatedBy: 'claude-opus-4.5' as const,
        generatedAt: new Date().toISOString(),
        reasoning: item.reasoning,
      },
    }));
  } catch (error) {
    console.error(`  ❌ Error generating ${category}/${type}/${language}:`, error);
    return [];
  }
}

async function generateAllCases(config: GenerationConfig): Promise<TestCase[]> {
  const allCases: TestCase[] = [];
  const types: TestCaseType[] = ['positive', 'negative', 'edge', 'obfuscated', 'cross'];
  
  console.log('\n🧪 Starting test case generation with Claude Opus 4.5\n');
  console.log(`Target: ${config.totalTarget} cases`);
  console.log(`Categories: ${config.categories.length}`);
  console.log(`Languages: ${config.languages.join(', ')}\n`);
  
  for (const category of config.categories) {
    console.log(`\n📁 Category: ${category}`);
    
    for (const language of config.languages) {
      const counts = CASES_PER_CATEGORY[language];
      
      for (const type of types) {
        const count = counts[type];
        if (count > 0) {
          const cases = await generateCasesForCategoryAndType(
            category,
            type,
            language,
            count
          );
          allCases.push(...cases);
          
          // Rate limiting - wait between API calls
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    console.log(`  ✓ Generated ${allCases.filter(c => c.category === category).length} cases for ${category}`);
  }
  
  return allCases;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('═'.repeat(60));
  console.log('TEST CASE GENERATOR - Claude Opus 4.5');
  console.log('═'.repeat(60));
  
  if (!ANTHROPIC_API_KEY) {
    console.error('\n❌ ANTHROPIC_API_KEY not set in .env file');
    process.exit(1);
  }
  
  const startTime = Date.now();
  
  // Generate all cases
  const cases = await generateAllCases(DEFAULT_GENERATION_CONFIG);
  
  // Calculate stats
  const stats = {
    total: cases.length,
    byLanguage: {
      en: cases.filter(c => c.language === 'en').length,
      ja: cases.filter(c => c.language === 'ja').length,
    } as Record<TestLanguage, number>,
    byCategory: {} as Record<string, number>,
    byType: {
      positive: cases.filter(c => c.type === 'positive').length,
      negative: cases.filter(c => c.type === 'negative').length,
      edge: cases.filter(c => c.type === 'edge').length,
      obfuscated: cases.filter(c => c.type === 'obfuscated').length,
      cross: cases.filter(c => c.type === 'cross').length,
    } as Record<TestCaseType, number>,
  };
  
  for (const category of DEFAULT_GENERATION_CONFIG.categories) {
    stats.byCategory[category] = cases.filter(c => c.category === category).length;
  }
  
  // Create dataset
  const dataset: TestCaseDataset = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    model: 'claude-opus-4.5',
    cases,
    stats,
  };
  
  // Ensure directory exists
  const dir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // Write to file
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(dataset, null, 2));
  
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  
  console.log('\n' + '═'.repeat(60));
  console.log('✅ GENERATION COMPLETE');
  console.log('═'.repeat(60));
  console.log(`\nTotal cases: ${stats.total}`);
  console.log(`English: ${stats.byLanguage.en}`);
  console.log(`Japanese: ${stats.byLanguage.ja}`);
  console.log(`\nBy type:`);
  console.log(`  Positive: ${stats.byType.positive}`);
  console.log(`  Negative: ${stats.byType.negative}`);
  console.log(`  Edge: ${stats.byType.edge}`);
  console.log(`  Obfuscated: ${stats.byType.obfuscated}`);
  console.log(`  Cross-category: ${stats.byType.cross}`);
  console.log(`\nTime: ${elapsed} minutes`);
  console.log(`Output: ${OUTPUT_PATH}`);
}

main().catch(console.error);

