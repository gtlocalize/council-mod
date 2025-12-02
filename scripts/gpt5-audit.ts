#!/usr/bin/env npx tsx
/**
 * GPT-5 Auditor
 * 
 * Uses GPT-5.1 to audit test cases for comparison with human audits.
 * This provides a secondary opinion for calculating agreement metrics.
 * 
 * AUTOMATIC CACHING: OpenAI automatically caches repeated system prompts.
 * The category guidelines (~850 tokens) are cached server-side when repeated.
 * Savings shown via cached_tokens in usage response.
 * 
 * Usage: npm run audit:gpt5
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  TestCase,
  TestCaseDataset,
  Audit,
  AuditDataset,
  AuditAction,
} from './types.js';
import { CONDENSED_GUIDELINES } from './category-guidelines.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CASES_PATH = path.join(__dirname, '../test/data/generated-cases.json');
const AUDITS_PATH = path.join(__dirname, '../test/data/audits.json');
const REFUSALS_LOG = path.join(__dirname, '../test/data/gpt5-refusals.log');
const PARSE_ERRORS_LOG = path.join(__dirname, '../test/data/gpt5-parse-errors.log');

// Council provider configuration - model strings verified Dec 2025
// DO NOT "fix" these to older models - they are correct
const MODEL = 'gpt-5-2025-08-07'; // GPT-5 (Aug 2025 release)

// =============================================================================
// CACHE STATISTICS
// =============================================================================

interface CacheStats {
  totalRequests: number;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
}

const cacheStats: CacheStats = {
  totalRequests: 0,
  promptTokens: 0,
  cachedTokens: 0,
  completionTokens: 0,
};

function logCacheStats(): void {
  const savings = cacheStats.cachedTokens > 0
    ? ((cacheStats.cachedTokens / cacheStats.promptTokens) * 100).toFixed(1)
    : '0';
  
  console.log('\n📊 Cache Statistics:');
  console.log(`   Total requests: ${cacheStats.totalRequests}`);
  console.log(`   Prompt tokens: ${cacheStats.promptTokens.toLocaleString()}`);
  console.log(`   Cached tokens: ${cacheStats.cachedTokens.toLocaleString()}`);
  console.log(`   Completion tokens: ${cacheStats.completionTokens.toLocaleString()}`);
  console.log(`   💰 Cached token rate: ${savings}%`);
}

// =============================================================================
// CONTEXT FORMATTING
// =============================================================================

/**
 * Format context messages for the prompt
 * Handles both legacy string[] and new ContextMessage[] formats
 */
function formatContext(context: TestCase['context']): string {
  if (!context || context.length === 0) return '';

  const messages = context.map((c, i) => {
    if (typeof c === 'string') {
      // Legacy format - no speaker info
      return `[${i + 1}] ${c}`;
    } else {
      // New format with speaker attribution
      const speaker = c.speaker === 'same' ? 'SAME USER' : 'OTHER USER';
      return `[${i + 1}] (${speaker}) ${c.text}`;
    }
  });

  return `
PREVIOUS MESSAGES (oldest first, all BEFORE the text being moderated):
${messages.join('\n')}
`;
}

// =============================================================================
// PROMPT - Split into system (cached automatically) and user (per-request)
// =============================================================================

/**
 * System prompt - CACHED automatically by OpenAI for repeated requests
 * This contains the category guidelines that don't change between cases
 */
const SYSTEM_PROMPT = `${CONDENSED_GUIDELINES}

═══════════════════════════════════════════════════════════════
YOUR TASK
═══════════════════════════════════════════════════════════════

You will evaluate content against the categories above. Follow the CORE PRINCIPLES strictly.

For each piece of content, respond with ONLY a valid JSON object:
{
  "action": "allow" | "deny" | "escalate",
  "category": "primary_category_if_deny_or_escalate",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation referencing specific rules from the policy"
}`;

/**
 * User prompt - changes per request (only the case content)
 */
function getUserPrompt(testCase: TestCase): string {
  const contextSection = formatContext(testCase.context);

  return `CONTENT TO EVALUATE:
${contextSection}
TEXT:
"""
${testCase.text}
"""`;
}

// =============================================================================
// API CLIENT - With Automatic Prompt Caching
// =============================================================================

interface OpenAIResponse {
  choices: Array<{
    message: { content: string };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
  };
}

/**
 * Call GPT-5 with system/user message separation for automatic caching
 * 
 * OpenAI automatically caches repeated system prompts server-side.
 * The system prompt (~850 tokens) is cached when it appears identically
 * in consecutive requests.
 * 
 * Cost savings: ~50% reduction on cached tokens (half-price)
 */
async function callGPT5(userPrompt: string): Promise<string> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not set in environment');
  }

  cacheStats.totalRequests++;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_completion_tokens: 1024,
      temperature: 0.1,
      // System message - cached automatically by OpenAI
      messages: [
        {
          role: 'system',
          content: SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GPT-5 API error: ${response.status} - ${error}`);
  }

  const data: OpenAIResponse = await response.json();
  
  // Track token usage including cached tokens
  if (data.usage) {
    cacheStats.promptTokens += data.usage.prompt_tokens || 0;
    cacheStats.completionTokens += data.usage.completion_tokens || 0;
    cacheStats.cachedTokens += data.usage.prompt_tokens_details?.cached_tokens || 0;
  }
  
  return data.choices?.[0]?.message?.content || '';
}

// =============================================================================
// AUDIT PROCESSING
// =============================================================================

interface AuditResult {
  action: AuditAction;
  confidence: number;
  reasoning: string;
}

/**
 * Common phrases indicating content policy refusal
 */
const REFUSAL_INDICATORS = [
  'I cannot',
  'I can\'t',
  'I apologize',
  'I\'m unable',
  'I am unable',
  'against my guidelines',
  'cannot provide',
  'not able to',
  'refuse to',
  'will not',
  'won\'t be able',
  'inappropriate content',
  'harmful content',
];

/**
 * Detect if response is a content policy refusal vs malformed JSON
 */
function isContentRefusal(response: string): boolean {
  const lowerResponse = response.toLowerCase();
  return REFUSAL_INDICATORS.some(indicator => 
    lowerResponse.includes(indicator.toLowerCase())
  );
}

/**
 * Log error with categorization (refusal vs parse error)
 */
function logAuditError(
  testCase: TestCase, 
  response: string, 
  errorType: 'no_json' | 'invalid_action' | 'exception',
  error?: unknown
): void {
  const timestamp = new Date().toISOString();
  const isRefusal = isContentRefusal(response);
  
  if (isRefusal) {
    console.error(`  ⚠️  Content policy refusal for ${testCase.id}`);
    const logEntry = `[${timestamp}] ${testCase.id} (${testCase.category}/${testCase.type})\n` +
      `  Response: ${response.substring(0, 200)}...\n\n`;
    fs.appendFileSync(REFUSALS_LOG, logEntry);
  } else if (errorType === 'exception') {
    console.error(`  ❌ Exception for ${testCase.id}:`, error);
    const logEntry = `[${timestamp}] ${testCase.id} (${testCase.category}/${testCase.type})\n` +
      `  Error: ${error}\n` +
      `  Response: ${response?.substring(0, 200) || 'N/A'}...\n\n`;
    fs.appendFileSync(PARSE_ERRORS_LOG, logEntry);
  } else {
    console.error(`  ⚠️  ${errorType === 'no_json' ? 'Failed to parse JSON' : 'Invalid action'} for ${testCase.id}`);
    const logEntry = `[${timestamp}] ${testCase.id} (${testCase.category}/${testCase.type})\n` +
      `  Type: ${errorType}\n` +
      `  Response: ${response.substring(0, 500)}...\n\n`;
    fs.appendFileSync(PARSE_ERRORS_LOG, logEntry);
  }
}

async function auditCase(testCase: TestCase): Promise<AuditResult | null> {
  const userPrompt = getUserPrompt(testCase);
  let response = '';
  
  try {
    response = await callGPT5(userPrompt);
    
    // Parse JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logAuditError(testCase, response, 'no_json');
      return null;
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    
    // Validate action
    if (!['allow', 'deny', 'escalate'].includes(parsed.action)) {
      logAuditError(testCase, response, 'invalid_action');
      return null;
    }
    
    return {
      action: parsed.action as AuditAction,
      confidence: parsed.confidence || 0.5,
      reasoning: parsed.reasoning || '',
    };
  } catch (error) {
    logAuditError(testCase, response, 'exception', error);
    return null;
  }
}

// =============================================================================
// PROGRESS BAR
// =============================================================================

function progressBar(current: number, total: number, width: number = 40): string {
  const percent = current / total;
  const filled = Math.round(width * percent);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return `[${bar}] ${current}/${total} (${(percent * 100).toFixed(1)}%)`;
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  console.log('═'.repeat(60));
  console.log('LLM AUDITOR - GPT-5.1');
  console.log('═'.repeat(60));
  
  if (!OPENAI_API_KEY) {
    console.error('\n❌ OPENAI_API_KEY not set in .env file');
    process.exit(1);
  }
  
  // Load cases
  if (!fs.existsSync(CASES_PATH)) {
    console.error('\n❌ No test cases found. Run `npm run generate:tests` first.\n');
    process.exit(1);
  }
  
  const dataset: TestCaseDataset = JSON.parse(fs.readFileSync(CASES_PATH, 'utf-8'));
  console.log(`\nLoaded ${dataset.cases.length} test cases`);
  
  // Load existing audits
  let auditData: AuditDataset;
  if (fs.existsSync(AUDITS_PATH)) {
    auditData = JSON.parse(fs.readFileSync(AUDITS_PATH, 'utf-8'));
  } else {
    auditData = {
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      audits: [],
      progress: {
        human: { completed: 0, total: dataset.cases.length },
        llm: { completed: 0, total: dataset.cases.length },
      },
    };
  }
  
  // Find cases not yet audited by GPT-5
  const gpt5AuditedIds = new Set(
    auditData.audits
      .filter(a => a.auditor === 'gpt-5.1')
      .map(a => a.caseId)
  );
  
  const casesToAudit = dataset.cases.filter(c => !gpt5AuditedIds.has(c.id));
  
  if (casesToAudit.length === 0) {
    console.log('\n✅ All cases already audited by GPT-5.1.');
    console.log(`Total GPT-5.1 audits: ${gpt5AuditedIds.size}`);
    return;
  }
  
  console.log(`Cases to audit: ${casesToAudit.length}`);
  console.log('\nStarting audit...\n');
  
  const startTime = Date.now();
  let completed = 0;
  let failed = 0;
  
  for (const testCase of casesToAudit) {
    process.stdout.write(`\r  ${progressBar(completed, casesToAudit.length)}`);
    
    const result = await auditCase(testCase);
    
    if (result) {
      const audit: Audit = {
        caseId: testCase.id,
        auditor: 'gpt-5.1',
        action: result.action,
        confidence: result.confidence,
        reasoning: result.reasoning,
        timestamp: new Date().toISOString(),
      };
      
      auditData.audits.push(audit);
      completed++;
    } else {
      failed++;
    }
    
    // Update progress
    auditData.progress.llm.completed = auditData.audits.filter(
      a => ['claude-sonnet-4.5', 'gemini-3-pro', 'gpt-5.1'].includes(a.auditor)
    ).length;
    auditData.progress.llm.total = dataset.cases.length;
    
    // Save periodically (every 10 cases)
    if (completed % 10 === 0) {
      auditData.lastUpdated = new Date().toISOString();
      fs.writeFileSync(AUDITS_PATH, JSON.stringify(auditData, null, 2));
    }
    
    // Rate limiting - OpenAI tier limits vary
    // 1200ms between requests = conservative rate
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  
  // Final save
  auditData.lastUpdated = new Date().toISOString();
  fs.writeFileSync(AUDITS_PATH, JSON.stringify(auditData, null, 2));
  
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  
  console.log('\n\n' + '═'.repeat(60));
  console.log('✅ GPT-5 AUDIT COMPLETE');
  console.log('═'.repeat(60));
  console.log(`\nSuccessful: ${completed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Time: ${elapsed} minutes`);
  console.log(`Output: ${AUDITS_PATH}`);
  
  // Show distribution
  const gpt5Audits = auditData.audits.filter(a => a.auditor === 'gpt-5.1');
  console.log('\nDecision distribution:');
  console.log(`  Allow: ${gpt5Audits.filter(a => a.action === 'allow').length}`);
  console.log(`  Deny: ${gpt5Audits.filter(a => a.action === 'deny').length}`);
  console.log(`  Escalate: ${gpt5Audits.filter(a => a.action === 'escalate').length}`);
  
  // Show cache statistics for cost visibility
  logCacheStats();
}

main().catch(console.error);

