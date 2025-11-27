#!/usr/bin/env npx tsx
/**
 * Claude Auditor
 * 
 * Uses Claude Sonnet 4.5 to audit test cases for comparison with human audits.
 * This provides a secondary opinion for calculating agreement metrics.
 * 
 * Usage: npm run audit:claude
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

// =============================================================================
// CONFIGURATION
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CASES_PATH = path.join(__dirname, '../test/data/generated-cases.json');
const AUDITS_PATH = path.join(__dirname, '../test/data/audits.json');
const MODEL = 'claude-sonnet-4-5-20250929';

// =============================================================================
// PROMPT
// =============================================================================

function getAuditPrompt(testCase: TestCase): string {
  const contextSection = testCase.context && testCase.context.length > 0
    ? `\nPREVIOUS MESSAGES (context):\n${testCase.context.map((c, i) => `[${i + 1}] ${c}`).join('\n')}\n`
    : '';

  return `You are a content moderation expert. Your task is to evaluate whether the following text should be allowed, denied, or escalated for human review.

DEFINITIONS:
- ALLOW: Content is acceptable and should be permitted
- DENY: Content clearly violates policies and should be blocked
- ESCALATE: Content is ambiguous and needs human judgment (edge cases, context-dependent, reclaimed language, educational discussion, etc.)

CONTENT TO EVALUATE:
${contextSection}
TEXT:
"""
${testCase.text}
"""

INSTRUCTIONS:
1. Consider the text in isolation AND with any provided context
2. Be nuanced - not everything offensive should be denied (consider: reclamation, education, quotes)
3. When truly uncertain, choose ESCALATE
4. Consider cultural context (text may be in English, Japanese, or other languages)

Respond with ONLY a JSON object:
{
  "action": "allow" | "deny" | "escalate",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`;
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
      max_tokens: 1024,
      temperature: 0.1,
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
// AUDIT PROCESSING
// =============================================================================

interface AuditResult {
  action: AuditAction;
  confidence: number;
  reasoning: string;
}

async function auditCase(testCase: TestCase): Promise<AuditResult | null> {
  const prompt = getAuditPrompt(testCase);
  
  try {
    const response = await callClaude(prompt);
    
    // Parse JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(`  ⚠️  Failed to parse JSON for ${testCase.id}`);
      return null;
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    
    // Validate action
    if (!['allow', 'deny', 'escalate'].includes(parsed.action)) {
      console.error(`  ⚠️  Invalid action for ${testCase.id}: ${parsed.action}`);
      return null;
    }
    
    return {
      action: parsed.action as AuditAction,
      confidence: parsed.confidence || 0.5,
      reasoning: parsed.reasoning || '',
    };
  } catch (error) {
    console.error(`  ❌ Error auditing ${testCase.id}:`, error);
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
  console.log('LLM AUDITOR - Claude Sonnet 4.5');
  console.log('═'.repeat(60));
  
  if (!ANTHROPIC_API_KEY) {
    console.error('\n❌ ANTHROPIC_API_KEY not set in .env file');
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
  
  // Find cases not yet audited by Claude
  const claudeAuditedIds = new Set(
    auditData.audits
      .filter(a => a.auditor === 'claude-sonnet-4.5')
      .map(a => a.caseId)
  );
  
  const casesToAudit = dataset.cases.filter(c => !claudeAuditedIds.has(c.id));
  
  if (casesToAudit.length === 0) {
    console.log('\n✅ All cases already audited by Claude.');
    console.log(`Total Claude audits: ${claudeAuditedIds.size}`);
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
        auditor: 'claude-sonnet-4.5',
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
      a => a.auditor === 'claude-sonnet-4.5' || a.auditor === 'gemini-3-pro'
    ).length;
    auditData.progress.llm.total = dataset.cases.length;
    
    // Save periodically (every 10 cases)
    if (completed % 10 === 0) {
      auditData.lastUpdated = new Date().toISOString();
      fs.writeFileSync(AUDITS_PATH, JSON.stringify(auditData, null, 2));
    }
    
    // Rate limiting - Anthropic allows 50 requests/min
    // 1200ms between requests = 50/min
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  
  // Final save
  auditData.lastUpdated = new Date().toISOString();
  fs.writeFileSync(AUDITS_PATH, JSON.stringify(auditData, null, 2));
  
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  
  console.log('\n\n' + '═'.repeat(60));
  console.log('✅ CLAUDE AUDIT COMPLETE');
  console.log('═'.repeat(60));
  console.log(`\nSuccessful: ${completed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Time: ${elapsed} minutes`);
  console.log(`Output: ${AUDITS_PATH}`);
  
  // Show distribution
  const claudeAudits = auditData.audits.filter(a => a.auditor === 'claude-sonnet-4.5');
  console.log('\nDecision distribution:');
  console.log(`  Allow: ${claudeAudits.filter(a => a.action === 'allow').length}`);
  console.log(`  Deny: ${claudeAudits.filter(a => a.action === 'deny').length}`);
  console.log(`  Escalate: ${claudeAudits.filter(a => a.action === 'escalate').length}`);
}

main().catch(console.error);

