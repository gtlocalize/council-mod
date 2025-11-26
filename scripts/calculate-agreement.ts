#!/usr/bin/env npx tsx
/**
 * Agreement Calculator
 * 
 * Calculates Gwet's AC1 coefficient between human and LLM audits.
 * Provides overall and per-category breakdown.
 * 
 * Usage: npm run agreement
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  TestCase,
  TestCaseDataset,
  AuditDataset,
  AuditAction,
  AgreementReport,
  AgreementMetrics,
  TestCaseType,
  TestLanguage,
} from './types.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CASES_PATH = path.join(__dirname, '../test/data/generated-cases.json');
const AUDITS_PATH = path.join(__dirname, '../test/data/audits.json');
const REPORT_PATH = path.join(__dirname, '../test/data/agreement-report.json');

// =============================================================================
// GWET AC1 CALCULATION
// =============================================================================

/**
 * Calculate Gwet's AC1 coefficient
 * 
 * AC1 is more robust than Cohen's Kappa when there's high agreement
 * and handles the paradox where high agreement can lead to low Kappa.
 * 
 * Formula: AC1 = (Po - Pe) / (1 - Pe)
 * where:
 *   Po = observed agreement
 *   Pe = expected agreement by chance
 */
function calculateGwetAC1(
  ratings1: AuditAction[],
  ratings2: AuditAction[]
): { ac1: number; agreements: number; disagreements: number } {
  if (ratings1.length !== ratings2.length || ratings1.length === 0) {
    return { ac1: 0, agreements: 0, disagreements: 0 };
  }
  
  const n = ratings1.length;
  const categories: AuditAction[] = ['allow', 'deny', 'escalate'];
  
  // Count agreements
  let agreements = 0;
  for (let i = 0; i < n; i++) {
    if (ratings1[i] === ratings2[i]) {
      agreements++;
    }
  }
  
  // Observed agreement (Po)
  const Po = agreements / n;
  
  // Calculate marginal proportions for AC1
  // Count how often each category is used (combined from both raters)
  const counts: Record<AuditAction, number> = {
    allow: 0,
    deny: 0,
    escalate: 0,
  };
  
  for (let i = 0; i < n; i++) {
    counts[ratings1[i]]++;
    counts[ratings2[i]]++;
  }
  
  // Marginal proportions
  const marginals: Record<AuditAction, number> = {
    allow: counts.allow / (2 * n),
    deny: counts.deny / (2 * n),
    escalate: counts.escalate / (2 * n),
  };
  
  // Expected agreement by chance (Pe) using Gwet's formula
  // Pe = sum(pi * (1 - pi)) / (K - 1) where K is number of categories
  let sumPiOneMinusPi = 0;
  for (const cat of categories) {
    const pi = marginals[cat];
    sumPiOneMinusPi += pi * (1 - pi);
  }
  
  const K = categories.length;
  const Pe = sumPiOneMinusPi / (K - 1);
  
  // AC1 coefficient
  const ac1 = Pe === 1 ? 1 : (Po - Pe) / (1 - Pe);
  
  return {
    ac1: Math.max(0, Math.min(1, ac1)), // Clamp to [0, 1]
    agreements,
    disagreements: n - agreements,
  };
}

// =============================================================================
// ANALYSIS
// =============================================================================

interface PairedAudit {
  caseId: string;
  testCase: TestCase;
  humanAction: AuditAction;
  llmAction: AuditAction;
}

function getPairedAudits(
  cases: TestCase[],
  audits: AuditDataset
): PairedAudit[] {
  const paired: PairedAudit[] = [];
  
  const humanAudits = new Map(
    audits.audits
      .filter(a => a.auditor === 'human')
      .map(a => [a.caseId, a])
  );
  
  const llmAudits = new Map(
    audits.audits
      .filter(a => a.auditor === 'gemini-3-pro')
      .map(a => [a.caseId, a])
  );
  
  for (const testCase of cases) {
    const human = humanAudits.get(testCase.id);
    const llm = llmAudits.get(testCase.id);
    
    if (human && llm) {
      paired.push({
        caseId: testCase.id,
        testCase,
        humanAction: human.action,
        llmAction: llm.action,
      });
    }
  }
  
  return paired;
}

function calculateMetrics(paired: PairedAudit[]): AgreementMetrics {
  if (paired.length === 0) {
    return { gwetAC1: 0, agreements: 0, disagreements: 0, total: 0 };
  }
  
  const humanRatings = paired.map(p => p.humanAction);
  const llmRatings = paired.map(p => p.llmAction);
  
  const result = calculateGwetAC1(humanRatings, llmRatings);
  
  return {
    gwetAC1: result.ac1,
    agreements: result.agreements,
    disagreements: result.disagreements,
    total: paired.length,
  };
}

// =============================================================================
// DISPLAY
// =============================================================================

function interpretAC1(ac1: number): string {
  if (ac1 >= 0.9) return 'Almost perfect';
  if (ac1 >= 0.8) return 'Strong';
  if (ac1 >= 0.6) return 'Moderate';
  if (ac1 >= 0.4) return 'Fair';
  if (ac1 >= 0.2) return 'Slight';
  return 'Poor';
}

function formatPercent(value: number): string {
  return (value * 100).toFixed(1) + '%';
}

function printMetrics(label: string, metrics: AgreementMetrics): void {
  const interpretation = interpretAC1(metrics.gwetAC1);
  console.log(`\n  ${label}`);
  console.log(`    Gwet AC1:     ${formatPercent(metrics.gwetAC1)} (${interpretation})`);
  console.log(`    Agreements:   ${metrics.agreements}/${metrics.total}`);
  console.log(`    Disagreements: ${metrics.disagreements}`);
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  console.log('═'.repeat(60));
  console.log('AGREEMENT CALCULATOR - Gwet AC1');
  console.log('═'.repeat(60));
  
  // Load data
  if (!fs.existsSync(CASES_PATH)) {
    console.error('\n❌ No test cases found. Run `npm run generate:tests` first.\n');
    process.exit(1);
  }
  
  if (!fs.existsSync(AUDITS_PATH)) {
    console.error('\n❌ No audits found. Run `npm run audit` and `npm run audit:llm` first.\n');
    process.exit(1);
  }
  
  const dataset: TestCaseDataset = JSON.parse(fs.readFileSync(CASES_PATH, 'utf-8'));
  const audits: AuditDataset = JSON.parse(fs.readFileSync(AUDITS_PATH, 'utf-8'));
  
  console.log(`\nLoaded ${dataset.cases.length} test cases`);
  console.log(`Human audits: ${audits.progress.human.completed}`);
  console.log(`LLM audits: ${audits.progress.llm.completed}`);
  
  // Get paired audits
  const paired = getPairedAudits(dataset.cases, audits);
  
  if (paired.length === 0) {
    console.error('\n❌ No paired audits found. Need both human and LLM audits for same cases.\n');
    process.exit(1);
  }
  
  console.log(`\nPaired audits: ${paired.length}`);
  
  // Calculate overall metrics
  const overall = calculateMetrics(paired);
  
  // Calculate by category
  const byCategory: Record<string, AgreementMetrics> = {};
  const categories = [...new Set(paired.map(p => p.testCase.category))];
  
  for (const category of categories) {
    const categoryPaired = paired.filter(p => p.testCase.category === category);
    byCategory[category] = calculateMetrics(categoryPaired);
  }
  
  // Calculate by type
  const byType: Record<TestCaseType, AgreementMetrics> = {} as any;
  const types: TestCaseType[] = ['positive', 'negative', 'edge', 'obfuscated', 'cross'];
  
  for (const type of types) {
    const typePaired = paired.filter(p => p.testCase.type === type);
    byType[type] = calculateMetrics(typePaired);
  }
  
  // Calculate by language
  const byLanguage: Record<TestLanguage, AgreementMetrics> = {} as any;
  const languages: TestLanguage[] = ['en', 'ja'];
  
  for (const lang of languages) {
    const langPaired = paired.filter(p => p.testCase.language === lang);
    byLanguage[lang] = calculateMetrics(langPaired);
  }
  
  // Get disagreements
  const disagreements = paired
    .filter(p => p.humanAction !== p.llmAction)
    .map(p => ({
      caseId: p.caseId,
      text: p.testCase.text.substring(0, 100) + (p.testCase.text.length > 100 ? '...' : ''),
      category: p.testCase.category,
      primaryAction: p.humanAction,
      secondaryAction: p.llmAction,
    }));
  
  // Create report
  const report: AgreementReport = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    auditors: {
      primary: 'human',
      secondary: 'gemini-3-pro',
    },
    overall,
    byCategory,
    byType,
    byLanguage,
    disagreements,
  };
  
  // Save report
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  
  // Display results
  console.log('\n' + '═'.repeat(60));
  console.log('RESULTS');
  console.log('═'.repeat(60));
  
  printMetrics('OVERALL', overall);
  
  console.log('\n' + '─'.repeat(60));
  console.log('BY CATEGORY');
  
  for (const category of categories) {
    printMetrics(category, byCategory[category]);
  }
  
  console.log('\n' + '─'.repeat(60));
  console.log('BY TYPE');
  
  for (const type of types) {
    if (byType[type].total > 0) {
      printMetrics(type, byType[type]);
    }
  }
  
  console.log('\n' + '─'.repeat(60));
  console.log('BY LANGUAGE');
  
  for (const lang of languages) {
    printMetrics(lang === 'en' ? 'English' : 'Japanese', byLanguage[lang]);
  }
  
  // Show sample disagreements
  if (disagreements.length > 0) {
    console.log('\n' + '─'.repeat(60));
    console.log('SAMPLE DISAGREEMENTS (first 5)');
    
    for (const d of disagreements.slice(0, 5)) {
      console.log(`\n  Case: ${d.caseId}`);
      console.log(`  Text: "${d.text}"`);
      console.log(`  Human: ${d.primaryAction} | LLM: ${d.secondaryAction}`);
    }
  }
  
  console.log('\n' + '═'.repeat(60));
  console.log(`Report saved to: ${REPORT_PATH}`);
  console.log('═'.repeat(60) + '\n');
}

main().catch(console.error);

