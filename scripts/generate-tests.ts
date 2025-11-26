#!/usr/bin/env npx tsx
/**
 * Regression Test Generator
 * 
 * Generates Mocha test files from the golden dataset (human-audited cases).
 * These tests serve as regression tests to catch if changes break moderation.
 * 
 * Usage: npm run generate:regression
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  TestCase,
  TestCaseDataset,
  AuditDataset,
  AuditAction,
  TestCaseType,
} from './types.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CASES_PATH = path.join(__dirname, '../test/data/generated-cases.json');
const AUDITS_PATH = path.join(__dirname, '../test/data/audits.json');
const OUTPUT_PATH = path.join(__dirname, '../test/golden-set.test.ts');

// =============================================================================
// CODE GENERATION
// =============================================================================

function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function generateTestCase(
  testCase: TestCase,
  expectedAction: AuditAction,
  index: number
): string {
  const contextArg = testCase.context && testCase.context.length > 0
    ? `, {\n      context: ${JSON.stringify(testCase.context)},\n    }`
    : '';
  
  const description = `[${testCase.type}] ${testCase.category} - case ${index + 1}`;
  
  return `
    it('should ${expectedAction}: ${escapeString(description)}', async function() {
      this.timeout(30000); // Allow 30s for API calls
      const result = await moderator.moderate('${escapeString(testCase.text)}'${contextArg});
      expect(result.action).to.equal('${expectedAction}');
    });`;
}

function generateTestFile(
  cases: Array<{ testCase: TestCase; expectedAction: AuditAction }>
): string {
  // Group by category
  const byCategory = new Map<string, Array<{ testCase: TestCase; expectedAction: AuditAction }>>();
  
  for (const c of cases) {
    const category = c.testCase.category;
    if (!byCategory.has(category)) {
      byCategory.set(category, []);
    }
    byCategory.get(category)!.push(c);
  }
  
  // Generate test blocks
  const categoryBlocks: string[] = [];
  
  for (const [category, categoryCases] of byCategory) {
    // Group by language within category
    const enCases = categoryCases.filter(c => c.testCase.language === 'en');
    const jaCases = categoryCases.filter(c => c.testCase.language === 'ja');
    
    let categoryBlock = `
  describe('${category}', function() {`;
    
    if (enCases.length > 0) {
      categoryBlock += `
    describe('English', function() {
${enCases.map((c, i) => generateTestCase(c.testCase, c.expectedAction, i)).join('\n')}
    });`;
    }
    
    if (jaCases.length > 0) {
      categoryBlock += `
    describe('Japanese', function() {
${jaCases.map((c, i) => generateTestCase(c.testCase, c.expectedAction, i)).join('\n')}
    });`;
    }
    
    categoryBlock += `
  });`;
    
    categoryBlocks.push(categoryBlock);
  }
  
  // Generate full file
  return `/**
 * Golden Dataset Regression Tests
 * 
 * AUTO-GENERATED - DO NOT EDIT MANUALLY
 * Generated from human-audited test cases.
 * 
 * Run: npm test
 * Regenerate: npm run generate:regression
 */

import { expect } from 'chai';
import { Moderator } from '../src/moderator';

describe('Golden Dataset Regression Tests', function() {
  let moderator: Moderator;
  
  before(function() {
    // Initialize moderator with default config
    moderator = new Moderator({
      openaiApiKey: process.env.OPENAI_API_KEY,
      provider: process.env.OPENAI_API_KEY ? 'openai' : 'local-only',
    });
  });
${categoryBlocks.join('\n')}
});
`;
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  console.log('═'.repeat(60));
  console.log('REGRESSION TEST GENERATOR');
  console.log('═'.repeat(60));
  
  // Load data
  if (!fs.existsSync(CASES_PATH)) {
    console.error('\n❌ No test cases found. Run `npm run generate:tests` first.\n');
    process.exit(1);
  }
  
  if (!fs.existsSync(AUDITS_PATH)) {
    console.error('\n❌ No audits found. Run `npm run audit` first.\n');
    process.exit(1);
  }
  
  const dataset: TestCaseDataset = JSON.parse(fs.readFileSync(CASES_PATH, 'utf-8'));
  const audits: AuditDataset = JSON.parse(fs.readFileSync(AUDITS_PATH, 'utf-8'));
  
  // Get human-audited cases (ground truth)
  const humanAudits = new Map(
    audits.audits
      .filter(a => a.auditor === 'human')
      .map(a => [a.caseId, a])
  );
  
  const casesWithAudits = dataset.cases
    .filter(c => humanAudits.has(c.id))
    .map(c => ({
      testCase: c,
      expectedAction: humanAudits.get(c.id)!.action,
    }));
  
  if (casesWithAudits.length === 0) {
    console.error('\n❌ No human-audited cases found. Run `npm run audit` first.\n');
    process.exit(1);
  }
  
  console.log(`\nLoaded ${casesWithAudits.length} human-audited cases`);
  
  // Generate test file
  const testCode = generateTestFile(casesWithAudits);
  
  // Write to file
  fs.writeFileSync(OUTPUT_PATH, testCode);
  
  // Stats
  const stats = {
    total: casesWithAudits.length,
    allow: casesWithAudits.filter(c => c.expectedAction === 'allow').length,
    deny: casesWithAudits.filter(c => c.expectedAction === 'deny').length,
    escalate: casesWithAudits.filter(c => c.expectedAction === 'escalate').length,
    categories: [...new Set(casesWithAudits.map(c => c.testCase.category))].length,
    en: casesWithAudits.filter(c => c.testCase.language === 'en').length,
    ja: casesWithAudits.filter(c => c.testCase.language === 'ja').length,
  };
  
  console.log('\n' + '─'.repeat(60));
  console.log('GENERATED TESTS');
  console.log('─'.repeat(60));
  console.log(`\n  Total tests: ${stats.total}`);
  console.log(`  Categories:  ${stats.categories}`);
  console.log(`\n  By expected action:`);
  console.log(`    Allow:    ${stats.allow}`);
  console.log(`    Deny:     ${stats.deny}`);
  console.log(`    Escalate: ${stats.escalate}`);
  console.log(`\n  By language:`);
  console.log(`    English:  ${stats.en}`);
  console.log(`    Japanese: ${stats.ja}`);
  
  console.log('\n' + '═'.repeat(60));
  console.log(`Output: ${OUTPUT_PATH}`);
  console.log('\nRun tests with: npm test');
  console.log('═'.repeat(60) + '\n');
}

main().catch(console.error);

