#!/usr/bin/env npx tsx
/**
 * Quick calibration test for profanity handling with new guidelines
 * Tests GPT-5.1 on profanity cases to verify it follows "ALLOW by default" policy
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { TestCase, TestCaseDataset } from './types.js';
import { CONDENSED_GUIDELINES } from './category-guidelines.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CASES_PATH = path.join(__dirname, '../test/data/generated-cases.json');

// Test case IDs to check
const PROFANITY_TEST_IDS = [
  'profanity-positive-en-1764167016407-0',
  'profanity-positive-en-1764167016407-1',
  'profanity-positive-en-1764167016407-2',
  'profanity-positive-en-1764167016407-3',
  'profanity-positive-en-1764167016407-4',
];

function getAuditPrompt(testCase: TestCase): string {
  return `${CONDENSED_GUIDELINES}

═══════════════════════════════════════════════════════════════
CONTENT TO EVALUATE
═══════════════════════════════════════════════════════════════

TEXT:
"""
${testCase.text}
"""

═══════════════════════════════════════════════════════════════
YOUR TASK
═══════════════════════════════════════════════════════════════

Evaluate the text against the categories above. Follow the CORE PRINCIPLES strictly.

Respond with ONLY a valid JSON object:
{
  "action": "allow" | "deny" | "escalate",
  "category": "primary_category_if_deny_or_escalate",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation referencing specific rules from the policy"
}`;
}

async function auditCase(testCase: TestCase): Promise<any> {
  const prompt = getAuditPrompt(testCase);
  
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-5.1-2025-11-13',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    }),
  });

  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(`OpenAI API error: ${JSON.stringify(data)}`);
  }

  const content = data.choices[0].message.content;
  return JSON.parse(content);
}

async function main() {
  console.log('🧪 Testing GPT-5.1 Profanity Calibration\n');
  console.log('Policy: Profanity should be ALLOW by default\n');
  console.log('Testing 5 profanity cases...\n');
  console.log('═'.repeat(80) + '\n');

  // Load test cases
  const dataset: TestCaseDataset = JSON.parse(fs.readFileSync(CASES_PATH, 'utf-8'));
  const testCases = dataset.cases.filter(c => PROFANITY_TEST_IDS.includes(c.id));

  let allowCount = 0;
  let denyCount = 0;
  let escalateCount = 0;

  for (const testCase of testCases) {
    console.log(`📝 Case: ${testCase.id}`);
    console.log(`Text: "${testCase.text}"\n`);

    try {
      const result = await auditCase(testCase);
      
      const actionEmoji = result.action === 'allow' ? '✅' : result.action === 'deny' ? '❌' : '⚠️';
      console.log(`${actionEmoji} Action: ${result.action.toUpperCase()}`);
      console.log(`   Category: ${result.category || 'none'}`);
      console.log(`   Confidence: ${result.confidence}`);
      console.log(`   Reasoning: ${result.reasoning}`);

      if (result.action === 'allow') allowCount++;
      else if (result.action === 'deny') denyCount++;
      else escalateCount++;

    } catch (error: any) {
      console.log(`❌ Error: ${error.message}`);
    }

    console.log('\n' + '─'.repeat(80) + '\n');
    await new Promise(resolve => setTimeout(resolve, 1200)); // Rate limit
  }

  console.log('═'.repeat(80));
  console.log('\n📊 RESULTS:');
  console.log(`✅ ALLOW: ${allowCount} (${(allowCount/testCases.length*100).toFixed(0)}%)`);
  console.log(`❌ DENY: ${denyCount} (${(denyCount/testCases.length*100).toFixed(0)}%)`);
  console.log(`⚠️  ESCALATE: ${escalateCount} (${(escalateCount/testCases.length*100).toFixed(0)}%)`);
  console.log('\n🎯 Expected: Most should be ALLOW (profanity alone) or DENY for harassment (profanity + attack)');
}

main().catch(console.error);

