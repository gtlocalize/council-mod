#!/usr/bin/env npx tsx
/**
 * LLM Auditor
 * 
 * Uses Gemini 3 Pro to audit test cases for comparison with human audits.
 * This provides a secondary opinion for calculating agreement metrics.
 * 
 * CONTEXT CACHING: Uses Gemini's context caching API to reduce costs by ~90%.
 * The category guidelines (~850 tokens) are cached and reused across requests.
 * 
 * Usage: npm run audit:llm
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

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const CASES_PATH = path.join(__dirname, '../test/data/generated-cases.json');
const AUDITS_PATH = path.join(__dirname, '../test/data/audits.json');
const REFUSALS_LOG = path.join(__dirname, '../test/data/gemini-refusals.log');
const PARSE_ERRORS_LOG = path.join(__dirname, '../test/data/gemini-parse-errors.log');

// Council provider configuration - model strings verified Dec 2025
// DO NOT "fix" these to older models - they are correct
const MODEL = 'gemini-3-pro-preview'; // Gemini 3 Pro (preview)

// =============================================================================
// CONTEXT CACHE MANAGEMENT
// =============================================================================

interface CachedContent {
  name: string;
  expireTime: string;
  model: string;
}

interface CacheStats {
  totalRequests: number;
  cacheHits: number;
  cacheCreations: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
}

const cacheStats: CacheStats = {
  totalRequests: 0,
  cacheHits: 0,
  cacheCreations: 0,
  inputTokens: 0,
  cachedTokens: 0,
  outputTokens: 0,
};

let currentCachedContent: CachedContent | null = null;

/**
 * Create or retrieve cached context containing the guidelines
 * Cache lasts for 5 minutes (minimum TTL for Gemini)
 */
async function getOrCreateCache(): Promise<string | null> {
  // Check if we have a valid cache
  if (currentCachedContent) {
    const expireTime = new Date(currentCachedContent.expireTime);
    if (expireTime > new Date()) {
      return currentCachedContent.name;
    }
    console.log('  📦 Cache expired, creating new one...');
  }

  // Create new cached content
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${MODEL}`,
          contents: [{
            role: 'user',
            parts: [{ text: SYSTEM_PROMPT }],
          }],
          ttl: '300s',  // 5 minutes (minimum)
          displayName: 'council-mod-guidelines',
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.log(`  ⚠️  Cache creation failed: ${response.status} - using direct prompts`);
      return null;
    }

    const data: CachedContent = await response.json();
    currentCachedContent = data;
    cacheStats.cacheCreations++;
    console.log(`  📦 Created context cache: ${data.name}`);
    return data.name;
  } catch (error) {
    console.log(`  ⚠️  Cache creation error: ${error}`);
    return null;
  }
}

function logCacheStats(): void {
  const savings = cacheStats.cachedTokens > 0
    ? ((cacheStats.cachedTokens / (cacheStats.inputTokens + cacheStats.cachedTokens)) * 100).toFixed(1)
    : '0';
  
  console.log('\n📊 Cache Statistics:');
  console.log(`   Total requests: ${cacheStats.totalRequests}`);
  console.log(`   Cache creations: ${cacheStats.cacheCreations}`);
  console.log(`   Input tokens: ${cacheStats.inputTokens.toLocaleString()}`);
  console.log(`   Cached tokens: ${cacheStats.cachedTokens.toLocaleString()}`);
  console.log(`   Output tokens: ${cacheStats.outputTokens.toLocaleString()}`);
  console.log(`   💰 Token savings: ${savings}%`);
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
// PROMPT - Split into system (cached) and user (per-request)
// =============================================================================

/**
 * System prompt - CACHED across all requests (~850 tokens)
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

/**
 * Full prompt for non-cached fallback
 */
function getFullPrompt(testCase: TestCase): string {
  return `${SYSTEM_PROMPT}

${getUserPrompt(testCase)}`;
}

// =============================================================================
// API CLIENT - With Context Caching
// =============================================================================

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text: string }> };
    finishReason?: string;
    safetyRatings?: unknown;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
  };
}

/**
 * Call Gemini with optional context caching
 * 
 * The system prompt (~850 tokens) can be cached using Gemini's context caching API.
 * Falls back to sending full prompt if caching fails.
 * 
 * Cost savings: ~90% reduction in input tokens when cache hits
 */
async function callGemini(userPrompt: string, cachedContentName: string | null): Promise<string> {
  if (!GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API_KEY not set in environment');
  }

  cacheStats.totalRequests++;
  
  let response: Response;
  
  if (cachedContentName) {
    // Use cached context
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cachedContent: cachedContentName,
          contents: [{
            role: 'user',
            parts: [{ text: userPrompt }],
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2048,
          },
        }),
      }
    );
    cacheStats.cacheHits++;
  } else {
    // Fallback: use system_instruction (still gets some server-side caching)
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }],
          },
          contents: [{
            role: 'user',
            parts: [{ text: userPrompt }],
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2048,
          },
        }),
      }
    );
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${error}`);
  }

  const data: GeminiResponse = await response.json();
  
  // Track token usage
  if (data.usageMetadata) {
    cacheStats.inputTokens += data.usageMetadata.promptTokenCount || 0;
    cacheStats.cachedTokens += data.usageMetadata.cachedContentTokenCount || 0;
    cacheStats.outputTokens += data.usageMetadata.candidatesTokenCount || 0;
  }
  
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  
  // Check if Gemini blocked the content
  if (!text) {
    const blockReason = data.candidates?.[0]?.finishReason;
    const safetyRatings = data.candidates?.[0]?.safetyRatings;
    if (blockReason || safetyRatings) {
      return `[GEMINI BLOCKED] Reason: ${blockReason || 'SAFETY'}, Ratings: ${JSON.stringify(safetyRatings)}`;
    }
  }
  
  return text || '';
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
    const responsePreview = response.length > 0 
      ? response.substring(0, 500) + (response.length > 500 ? '...' : '')
      : '(EMPTY RESPONSE)';
    const logEntry = `[${timestamp}] ${testCase.id} (${testCase.category}/${testCase.type})\n` +
      `  Type: ${errorType}\n` +
      `  Response length: ${response.length}\n` +
      `  Response: ${responsePreview}\n\n`;
    fs.appendFileSync(PARSE_ERRORS_LOG, logEntry);
  }
}

async function auditCase(testCase: TestCase, cachedContentName: string | null): Promise<AuditResult | null> {
  const userPrompt = getUserPrompt(testCase);
  let response = '';
  
  try {
    response = await callGemini(userPrompt, cachedContentName);
    
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
  console.log('LLM AUDITOR - Gemini 3 Pro');
  console.log('═'.repeat(60));
  
  if (!GOOGLE_API_KEY) {
    console.error('\n❌ GOOGLE_API_KEY not set in .env file');
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
  
  // Find cases not yet audited by LLM
  const llmAuditedIds = new Set(
    auditData.audits
      .filter(a => a.auditor === 'gemini-3-pro')
      .map(a => a.caseId)
  );
  
  const casesToAudit = dataset.cases.filter(c => !llmAuditedIds.has(c.id));
  
  if (casesToAudit.length === 0) {
    console.log('\n✅ All cases already audited by LLM.');
    console.log(`Total LLM audits: ${llmAuditedIds.size}`);
    return;
  }
  
  console.log(`Cases to audit: ${casesToAudit.length}`);
  console.log('\nInitializing context cache...');
  
  // Try to create cached context (will be reused for all requests)
  const cachedContentName = await getOrCreateCache();
  
  console.log('\nStarting audit...\n');
  
  const startTime = Date.now();
  let completed = 0;
  let failed = 0;
  
  for (const testCase of casesToAudit) {
    process.stdout.write(`\r  ${progressBar(completed, casesToAudit.length)}`);
    
    const result = await auditCase(testCase, cachedContentName);
    
    if (result) {
      const audit: Audit = {
        caseId: testCase.id,
        auditor: 'gemini-3-pro',
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
      a => a.auditor === 'gemini-3-pro'
    ).length;
    auditData.progress.llm.total = dataset.cases.length;
    
    // Save periodically (every 10 cases)
    if (completed % 10 === 0) {
      auditData.lastUpdated = new Date().toISOString();
      fs.writeFileSync(AUDITS_PATH, JSON.stringify(auditData, null, 2));
    }
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Final save
  auditData.lastUpdated = new Date().toISOString();
  fs.writeFileSync(AUDITS_PATH, JSON.stringify(auditData, null, 2));
  
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  
  console.log('\n\n' + '═'.repeat(60));
  console.log('✅ LLM AUDIT COMPLETE');
  console.log('═'.repeat(60));
  console.log(`\nSuccessful: ${completed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Time: ${elapsed} minutes`);
  console.log(`Output: ${AUDITS_PATH}`);
  
  // Show distribution
  const llmAudits = auditData.audits.filter(a => a.auditor === 'gemini-3-pro');
  console.log('\nDecision distribution:');
  console.log(`  Allow: ${llmAudits.filter(a => a.action === 'allow').length}`);
  console.log(`  Deny: ${llmAudits.filter(a => a.action === 'deny').length}`);
  console.log(`  Escalate: ${llmAudits.filter(a => a.action === 'escalate').length}`);
  
  // Show cache statistics for cost visibility
  logCacheStats();
}

main().catch(console.error);

