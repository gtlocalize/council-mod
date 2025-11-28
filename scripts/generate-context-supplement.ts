#!/usr/bin/env npx tsx
/**
 * Context Supplement Generator
 * 
 * Generates additional test cases where context does NOT excuse the content.
 * Fixes bias in original test set where all context cases were "exonerating".
 * 
 * Distribution:
 * - 50% context condemns (makes it worse)
 * - 35% context neutral (doesn't change verdict)
 * - 15% bad regardless (context irrelevant)
 * 
 * Usage: npm run generate:context-supplement
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { TestCase, TestCaseDataset } from './types.js';
import { ModerationCategory } from '../src/types.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CASES_PATH = path.join(__dirname, '../test/data/generated-cases.json');
const MODEL = 'claude-sonnet-4-5-20250929';

const CATEGORIES: ModerationCategory[] = [
  'hate_speech',
  'harassment', 
  'sexual_harassment',
  'violence',
  'threats',
  'self_harm',
  'drugs_illegal',
  'spam_scam',
];

// =============================================================================
// PROMPTS
// =============================================================================

function getCondemnPrompt(category: ModerationCategory, count: number, language: 'en' | 'ja'): string {
  const langName = language === 'en' ? 'English' : 'Japanese';
  const langInstructions = language === 'ja' 
    ? 'Write in Japanese. Use realistic Japanese internet language, slang, and cultural context.'
    : '';

  return `You are generating test cases for a content moderation QA system.

TASK: Generate ${count} test cases where CONTEXT MAKES THE CONTENT WORSE.

These are messages that might seem borderline alone, but the context reveals:
- It's part of ongoing harassment/stalking
- It's an escalating threat pattern
- Previous messages show malicious intent
- The target has asked them to stop

CATEGORY: ${category}
LANGUAGE: ${langName}
${langInstructions}

OUTPUT FORMAT: JSON array of objects:
{
  "text": "the message to moderate",
  "context": ["previous message 1", "previous message 2", "previous message 3"],
  "reasoning": "why context makes this worse"
}

EXAMPLES:

1. Harassment pattern:
   text: "Just checking in again :)"
   context: ["Why won't you respond?", "I can see you're online", "You can't ignore me forever"]
   reasoning: "Innocuous message but context shows stalking behavior"

2. Escalating threats:
   text: "You better watch yourself"
   context: ["I know where you work", "Nice car you drive"]
   reasoning: "Generic warning becomes threat with surveillance context"

3. Targeted attack setup:
   text: "Hey everyone, look at this person"
   context: ["Let's make their life hell", "Who's got their address?"]
   reasoning: "Call to action becomes doxxing/harassment coordination"

Generate ${count} realistic, varied examples. Each should have 2-4 context messages.
Return ONLY valid JSON array.`;
}

function getNeutralPrompt(category: ModerationCategory, count: number, language: 'en' | 'ja'): string {
  const langName = language === 'en' ? 'English' : 'Japanese';
  const langInstructions = language === 'ja' 
    ? 'Write in Japanese. Use realistic Japanese internet language, slang, and cultural context.'
    : '';

  return `You are generating test cases for a content moderation QA system.

TASK: Generate ${count} test cases where CONTEXT IS NEUTRAL/IRRELEVANT.

These are messages that are clearly violations, and the context:
- Is just normal conversation that doesn't change anything
- Doesn't excuse or worsen the violation
- Is present but irrelevant to the harmful content

CATEGORY: ${category}
LANGUAGE: ${langName}
${langInstructions}

OUTPUT FORMAT: JSON array of objects:
{
  "text": "the message to moderate (clear violation)",
  "context": ["unrelated previous message 1", "unrelated previous message 2"],
  "reasoning": "why context doesn't change the verdict"
}

EXAMPLES:

1. Clear violation with casual context:
   text: "kys you worthless piece of shit"
   context: ["How was your day?", "Did you see the game last night?"]
   reasoning: "Self-harm incitement - casual context doesn't excuse it"

2. Slur with irrelevant context:
   text: "All [slur] should be deported"
   context: ["What time is the meeting?", "I'll be there at 3pm"]
   reasoning: "Hate speech - business context completely unrelated"

3. Explicit threat with normal context:
   text: "I'm going to find you and hurt you"
   context: ["Nice weather today", "Want to grab lunch?"]
   reasoning: "Direct threat - pleasant context doesn't mitigate"

Generate ${count} realistic examples where the violation is CLEAR and context is IRRELEVANT.
Return ONLY valid JSON array.`;
}

function getBadRegardlessPrompt(category: ModerationCategory, count: number, language: 'en' | 'ja'): string {
  const langName = language === 'en' ? 'English' : 'Japanese';
  const langInstructions = language === 'ja' 
    ? 'Write in Japanese. Use realistic Japanese internet language, slang, and cultural context.'
    : '';

  return `You are generating test cases for a content moderation QA system.

TASK: Generate ${count} test cases that are BAD REGARDLESS of any context.

These are severe violations where NO context could ever excuse them:
- Explicit detailed threats
- Extreme hate speech with calls to violence
- Instructions for self-harm
- Severe targeted harassment

Even with "educational" or "quoting" framing, these cross the line.

CATEGORY: ${category}
LANGUAGE: ${langName}
${langInstructions}

OUTPUT FORMAT: JSON array of objects:
{
  "text": "severe violation that no context excuses",
  "context": ["some context that might try to excuse it but fails"],
  "reasoning": "why this is bad regardless of any context"
}

EXAMPLES:

1. Extreme threat:
   text: "I have your address and I'm coming to kill your entire family tonight"
   context: ["We were just joking around", "It's just banter"]
   reasoning: "Specific credible threat - 'joking' context doesn't help"

2. Violence incitement:
   text: "Here's how to make a pipe bomb to use at the school"
   context: ["This is for educational purposes", "Just researching"]
   reasoning: "Instructions for mass violence - 'educational' framing doesn't excuse"

3. Targeted severe harassment:
   text: "[Name], everyone knows you're a [slur]. Your family should die."
   context: ["They started it", "They insulted me first"]
   reasoning: "Severe targeted attack - retaliation doesn't justify"

Generate ${count} realistic examples of SEVERE violations that NO CONTEXT excuses.
Return ONLY valid JSON array.`;
}

// =============================================================================
// API CLIENT
// =============================================================================

async function callClaude(prompt: string): Promise<string> {
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
      model: MODEL,
      max_tokens: 8192,
      temperature: 0.8,  // Higher for variety
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
  return data.content?.[0]?.text || '';
}

// =============================================================================
// GENERATION
// =============================================================================

interface GeneratedCase {
  text: string;
  context: string[];
  reasoning: string;
}

async function generateCases(
  promptFn: (cat: ModerationCategory, count: number, lang: 'en' | 'ja') => string,
  contextIntent: 'condemning' | 'neutral' | 'bad_regardless',
  casesPerCategory: number,
  language: 'en' | 'ja'
): Promise<TestCase[]> {
  const results: TestCase[] = [];
  
  for (const category of CATEGORIES) {
    process.stdout.write(`  ${category} (${language})...`);
    
    try {
      const prompt = promptFn(category, casesPerCategory, language);
      const response = await callClaude(prompt);
      
      // Parse JSON array from response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.log(' ⚠️ Failed to parse');
        continue;
      }
      
      const cases: GeneratedCase[] = JSON.parse(jsonMatch[0]);
      
      for (let i = 0; i < cases.length; i++) {
        const c = cases[i];
        const timestamp = Date.now();
        
        results.push({
          id: `${category}-context-${contextIntent}-${language}-${timestamp}-${i}`,
          text: c.text,
          language,
          category,
          type: 'edge',  // Context cases are edge cases
          context: c.context,
          metadata: {
            generatedBy: 'claude-sonnet-4.5' as any,
            generatedAt: new Date().toISOString(),
            reasoning: c.reasoning,
            contextIntent,  // NEW: Track what the context does
          } as any,
        });
      }
      
      console.log(` ✅ ${cases.length} cases`);
    } catch (error) {
      console.log(` ❌ Error: ${error}`);
    }
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  
  return results;
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  console.log('═'.repeat(60));
  console.log('CONTEXT SUPPLEMENT GENERATOR');
  console.log('═'.repeat(60));
  
  if (!ANTHROPIC_API_KEY) {
    console.error('\n❌ ANTHROPIC_API_KEY not set in .env file');
    process.exit(1);
  }
  
  // Load existing cases
  if (!fs.existsSync(CASES_PATH)) {
    console.error('\n❌ No test cases found. Run `npm run generate:tests` first.\n');
    process.exit(1);
  }
  
  const dataset: TestCaseDataset = JSON.parse(fs.readFileSync(CASES_PATH, 'utf-8'));
  const originalCount = dataset.cases.length;
  console.log(`\nLoaded ${originalCount} existing test cases`);
  
  // Target: 100 new cases
  // Distribution: 50 condemns, 35 neutral, 15 bad_regardless
  // Split between EN and JA
  
  console.log('\n📝 Generating context-condemning cases (EN)...');
  const condemnEn = await generateCases(getCondemnPrompt, 'condemning', 3, 'en');
  
  console.log('\n📝 Generating context-condemning cases (JA)...');
  const condemnJa = await generateCases(getCondemnPrompt, 'condemning', 2, 'ja');
  
  console.log('\n📝 Generating context-neutral cases (EN)...');
  const neutralEn = await generateCases(getNeutralPrompt, 'neutral', 2, 'en');
  
  console.log('\n📝 Generating context-neutral cases (JA)...');
  const neutralJa = await generateCases(getNeutralPrompt, 'neutral', 2, 'ja');
  
  console.log('\n📝 Generating bad-regardless cases (EN)...');
  const badEn = await generateCases(getBadRegardlessPrompt, 'bad_regardless', 1, 'en');
  
  console.log('\n📝 Generating bad-regardless cases (JA)...');
  const badJa = await generateCases(getBadRegardlessPrompt, 'bad_regardless', 1, 'ja');
  
  // Combine all new cases
  const newCases = [
    ...condemnEn,
    ...condemnJa,
    ...neutralEn,
    ...neutralJa,
    ...badEn,
    ...badJa,
  ];
  
  console.log('\n' + '─'.repeat(60));
  console.log(`Generated ${newCases.length} new context cases`);
  console.log('─'.repeat(60));
  
  // Distribution breakdown
  const condemning = newCases.filter(c => (c.metadata as any).contextIntent === 'condemning').length;
  const neutral = newCases.filter(c => (c.metadata as any).contextIntent === 'neutral').length;
  const badRegardless = newCases.filter(c => (c.metadata as any).contextIntent === 'bad_regardless').length;
  
  console.log(`  Context condemns: ${condemning}`);
  console.log(`  Context neutral:  ${neutral}`);
  console.log(`  Bad regardless:   ${badRegardless}`);
  
  // Add to dataset
  dataset.cases.push(...newCases);
  dataset.generatedAt = new Date().toISOString();
  
  // Update stats
  if (dataset.stats) {
    dataset.stats.total = dataset.cases.length;
    
    for (const c of newCases) {
      dataset.stats.byLanguage[c.language] = (dataset.stats.byLanguage[c.language] || 0) + 1;
      dataset.stats.byCategory[c.category] = (dataset.stats.byCategory[c.category] || 0) + 1;
      dataset.stats.byType[c.type] = (dataset.stats.byType[c.type] || 0) + 1;
    }
  }
  
  // Save
  fs.writeFileSync(CASES_PATH, JSON.stringify(dataset, null, 2));
  
  console.log('\n' + '═'.repeat(60));
  console.log('✅ GENERATION COMPLETE');
  console.log('═'.repeat(60));
  console.log(`\nOriginal cases: ${originalCount}`);
  console.log(`New cases:      ${newCases.length}`);
  console.log(`Total cases:    ${dataset.cases.length}`);
  console.log(`\nOutput: ${CASES_PATH}`);
  console.log('\nNew cases will be picked up by audit scripts automatically.');
}

main().catch(console.error);

