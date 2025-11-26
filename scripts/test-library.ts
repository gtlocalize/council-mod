#!/usr/bin/env npx tsx
/**
 * Library Test Runner
 * 
 * Runs council-mod against the golden dataset (human-audited cases)
 * and calculates accuracy, precision, recall, and F1 scores.
 * 
 * Usage: npm run test:library
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  TestCase,
  TestCaseDataset,
  AuditDataset,
  AuditAction,
  PerformanceReport,
  CategoryPerformance,
  TestCaseType,
  TestLanguage,
} from './types.js';
import { Moderator } from '../src/moderator.js';
import { ModerationCategory } from '../src/types.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CASES_PATH = path.join(__dirname, '../test/data/generated-cases.json');
const AUDITS_PATH = path.join(__dirname, '../test/data/audits.json');
const REPORT_PATH = path.join(__dirname, '../test/data/library-performance.json');

// =============================================================================
// METRICS CALCULATION
// =============================================================================

interface TestResult {
  caseId: string;
  testCase: TestCase;
  expected: AuditAction;
  actual: AuditAction;
  severity: number;
  confidence: number;
  latencyMs: number;
  correct: boolean;
}

function calculateCategoryPerformance(results: TestResult[]): CategoryPerformance {
  // For each category, we consider "deny" as positive and "allow/escalate" as negative
  let tp = 0, fp = 0, tn = 0, fn = 0;
  
  for (const r of results) {
    const expectedPositive = r.expected === 'deny';
    const actualPositive = r.actual === 'deny';
    
    if (expectedPositive && actualPositive) tp++;
    else if (!expectedPositive && actualPositive) fp++;
    else if (!expectedPositive && !actualPositive) tn++;
    else if (expectedPositive && !actualPositive) fn++;
  }
  
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1Score = precision + recall > 0 
    ? 2 * (precision * recall) / (precision + recall) 
    : 0;
  
  return {
    precision,
    recall,
    f1Score,
    truePositives: tp,
    falsePositives: fp,
    trueNegatives: tn,
    falseNegatives: fn,
  };
}

function calculatePercentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
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
  console.log('LIBRARY TEST RUNNER');
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
  
  const casesToTest = dataset.cases.filter(c => humanAudits.has(c.id));
  
  if (casesToTest.length === 0) {
    console.error('\n❌ No human-audited cases found. Run `npm run audit` first.\n');
    process.exit(1);
  }
  
  console.log(`\nLoaded ${casesToTest.length} human-audited cases`);
  
  // Initialize moderator
  const moderator = new Moderator({
    openaiApiKey: process.env.OPENAI_API_KEY,
    provider: process.env.OPENAI_API_KEY ? 'openai' : 'local-only',
  });
  
  const providerInfo = moderator.getProviderInfo();
  console.log(`Provider: ${providerInfo.primary.displayName}`);
  console.log(`Council: ${providerInfo.councilAvailable ? 'Available' : 'Not available'}\n`);
  
  // Run tests
  const results: TestResult[] = [];
  const startTime = Date.now();
  
  console.log('Testing...\n');
  
  for (let i = 0; i < casesToTest.length; i++) {
    const testCase = casesToTest[i];
    const humanAudit = humanAudits.get(testCase.id)!;
    
    process.stdout.write(`\r  ${progressBar(i, casesToTest.length)}`);
    
    try {
      const result = await moderator.moderate(testCase.text, {
        context: testCase.context,
      });
      
      // Map our action to audit action
      const actual: AuditAction = result.action;
      const expected: AuditAction = humanAudit.action;
      
      results.push({
        caseId: testCase.id,
        testCase,
        expected,
        actual,
        severity: result.severity,
        confidence: result.confidence,
        latencyMs: result.processingTimeMs,
        correct: actual === expected,
      });
    } catch (error) {
      console.error(`\n  ❌ Error testing ${testCase.id}:`, error);
      results.push({
        caseId: testCase.id,
        testCase,
        expected: humanAudit.action,
        actual: 'escalate', // Default to escalate on error
        severity: 0,
        confidence: 0,
        latencyMs: 0,
        correct: false,
      });
    }
    
    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  process.stdout.write(`\r  ${progressBar(casesToTest.length, casesToTest.length)}\n`);
  
  // Calculate metrics
  const correct = results.filter(r => r.correct).length;
  const latencies = results.map(r => r.latencyMs);
  
  // Overall
  const overall = {
    accuracy: correct / results.length,
    tested: results.length,
    correct,
    incorrect: results.length - correct,
  };
  
  // By category
  const byCategory: Record<string, CategoryPerformance> = {};
  const categories = [...new Set(results.map(r => r.testCase.category))];
  
  for (const category of categories) {
    const categoryResults = results.filter(r => r.testCase.category === category);
    byCategory[category] = calculateCategoryPerformance(categoryResults);
  }
  
  // By type
  const byType: Record<TestCaseType, { accuracy: number; tested: number }> = {} as any;
  const types: TestCaseType[] = ['positive', 'negative', 'edge', 'obfuscated', 'cross'];
  
  for (const type of types) {
    const typeResults = results.filter(r => r.testCase.type === type);
    if (typeResults.length > 0) {
      byType[type] = {
        accuracy: typeResults.filter(r => r.correct).length / typeResults.length,
        tested: typeResults.length,
      };
    }
  }
  
  // By language
  const byLanguage: Record<TestLanguage, { accuracy: number; tested: number }> = {} as any;
  const languages: TestLanguage[] = ['en', 'ja'];
  
  for (const lang of languages) {
    const langResults = results.filter(r => r.testCase.language === lang);
    if (langResults.length > 0) {
      byLanguage[lang] = {
        accuracy: langResults.filter(r => r.correct).length / langResults.length,
        tested: langResults.length,
      };
    }
  }
  
  // Failures
  const failures = results
    .filter(r => !r.correct)
    .map(r => ({
      caseId: r.caseId,
      text: r.testCase.text.substring(0, 100) + (r.testCase.text.length > 100 ? '...' : ''),
      category: r.testCase.category,
      expected: r.expected,
      actual: r.actual,
      severity: r.severity,
      confidence: r.confidence,
    }));
  
  // Create report
  const report: PerformanceReport = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    config: {
      provider: providerInfo.primary.displayName,
      councilEnabled: providerInfo.councilAvailable,
    },
    overall,
    byCategory,
    byType,
    byLanguage,
    failures,
    latency: {
      average: latencies.reduce((a, b) => a + b, 0) / latencies.length,
      p50: calculatePercentile(latencies, 50),
      p95: calculatePercentile(latencies, 95),
      p99: calculatePercentile(latencies, 99),
    },
  };
  
  // Save report
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  
  // Display results
  console.log('\n' + '═'.repeat(60));
  console.log('RESULTS');
  console.log('═'.repeat(60));
  
  console.log(`\n  OVERALL`);
  console.log(`    Accuracy:  ${(overall.accuracy * 100).toFixed(1)}%`);
  console.log(`    Correct:   ${overall.correct}/${overall.tested}`);
  console.log(`    Failures:  ${overall.incorrect}`);
  
  console.log(`\n  LATENCY`);
  console.log(`    Average:   ${report.latency.average.toFixed(0)}ms`);
  console.log(`    P50:       ${report.latency.p50.toFixed(0)}ms`);
  console.log(`    P95:       ${report.latency.p95.toFixed(0)}ms`);
  console.log(`    P99:       ${report.latency.p99.toFixed(0)}ms`);
  
  console.log('\n' + '─'.repeat(60));
  console.log('BY TYPE');
  
  for (const type of types) {
    if (byType[type]) {
      console.log(`\n  ${type}`);
      console.log(`    Accuracy: ${(byType[type].accuracy * 100).toFixed(1)}%`);
      console.log(`    Tested:   ${byType[type].tested}`);
    }
  }
  
  console.log('\n' + '─'.repeat(60));
  console.log('BY LANGUAGE');
  
  for (const lang of languages) {
    if (byLanguage[lang]) {
      console.log(`\n  ${lang === 'en' ? 'English' : 'Japanese'}`);
      console.log(`    Accuracy: ${(byLanguage[lang].accuracy * 100).toFixed(1)}%`);
      console.log(`    Tested:   ${byLanguage[lang].tested}`);
    }
  }
  
  // Show sample failures
  if (failures.length > 0) {
    console.log('\n' + '─'.repeat(60));
    console.log('SAMPLE FAILURES (first 5)');
    
    for (const f of failures.slice(0, 5)) {
      console.log(`\n  Case: ${f.caseId}`);
      console.log(`  Text: "${f.text}"`);
      console.log(`  Expected: ${f.expected} | Actual: ${f.actual}`);
      console.log(`  Severity: ${(f.severity * 100).toFixed(1)}% | Confidence: ${(f.confidence * 100).toFixed(1)}%`);
    }
  }
  
  console.log('\n' + '═'.repeat(60));
  console.log(`Time: ${elapsed} minutes`);
  console.log(`Report saved to: ${REPORT_PATH}`);
  console.log('═'.repeat(60) + '\n');
}

main().catch(console.error);

