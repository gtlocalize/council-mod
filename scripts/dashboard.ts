#!/usr/bin/env npx tsx
/**
 * QA Dashboard
 * 
 * Terminal dashboard showing dataset stats, audit progress,
 * agreement metrics, and library performance.
 * 
 * Usage: npm run dashboard
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  TestCaseDataset,
  AuditDataset,
  AgreementReport,
  PerformanceReport,
} from './types.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../test/data');
const CASES_PATH = path.join(DATA_DIR, 'generated-cases.json');
const AUDITS_PATH = path.join(DATA_DIR, 'audits.json');
const AGREEMENT_PATH = path.join(DATA_DIR, 'agreement-report.json');
const PERFORMANCE_PATH = path.join(DATA_DIR, 'library-performance.json');

// =============================================================================
// DISPLAY HELPERS
// =============================================================================

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function color(text: string, c: keyof typeof colors): string {
  return `${colors[c]}${text}${colors.reset}`;
}

function formatPercent(value: number): string {
  return (value * 100).toFixed(1) + '%';
}

function progressBar(current: number, total: number, width: number = 30): string {
  const percent = total > 0 ? current / total : 0;
  const filled = Math.round(width * percent);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function interpretAC1(ac1: number): string {
  if (ac1 >= 0.9) return color('Almost perfect', 'green');
  if (ac1 >= 0.8) return color('Strong', 'green');
  if (ac1 >= 0.6) return color('Moderate', 'yellow');
  if (ac1 >= 0.4) return color('Fair', 'yellow');
  if (ac1 >= 0.2) return color('Slight', 'red');
  return color('Poor', 'red');
}

function interpretAccuracy(acc: number): string {
  if (acc >= 0.9) return color('Excellent', 'green');
  if (acc >= 0.8) return color('Good', 'green');
  if (acc >= 0.7) return color('Acceptable', 'yellow');
  if (acc >= 0.6) return color('Needs work', 'yellow');
  return color('Poor', 'red');
}

// =============================================================================
// SECTIONS
// =============================================================================

function printHeader(): void {
  console.clear();
  console.log(color('╔' + '═'.repeat(68) + '╗', 'cyan'));
  console.log(color('║', 'cyan') + color('                    COUNCIL-MOD QA DASHBOARD                       ', 'bright') + color('║', 'cyan'));
  console.log(color('╚' + '═'.repeat(68) + '╝', 'cyan'));
  console.log();
}

function printDatasetStats(dataset: TestCaseDataset | null): void {
  console.log(color('┌─ DATASET STATISTICS ' + '─'.repeat(48) + '┐', 'blue'));
  
  if (!dataset) {
    console.log(color('│', 'blue') + '  No dataset found. Run: npm run generate:tests');
    console.log(color('└' + '─'.repeat(68) + '┘', 'blue'));
    console.log();
    return;
  }
  
  const stats = dataset.stats;
  
  console.log(color('│', 'blue') + `  Total cases: ${color(stats.total.toString(), 'bright')}`);
  console.log(color('│', 'blue') + `  Generated:   ${dataset.generatedAt}`);
  console.log(color('│', 'blue') + `  Model:       ${dataset.model}`);
  console.log(color('│', 'blue'));
  console.log(color('│', 'blue') + `  By language:`);
  console.log(color('│', 'blue') + `    English:   ${stats.byLanguage.en} cases`);
  console.log(color('│', 'blue') + `    Japanese:  ${stats.byLanguage.ja} cases`);
  console.log(color('│', 'blue'));
  console.log(color('│', 'blue') + `  By type:`);
  console.log(color('│', 'blue') + `    Positive:   ${stats.byType.positive}`);
  console.log(color('│', 'blue') + `    Negative:   ${stats.byType.negative}`);
  console.log(color('│', 'blue') + `    Edge:       ${stats.byType.edge}`);
  console.log(color('│', 'blue') + `    Obfuscated: ${stats.byType.obfuscated}`);
  console.log(color('│', 'blue') + `    Cross:      ${stats.byType.cross}`);
  console.log(color('└' + '─'.repeat(68) + '┘', 'blue'));
  console.log();
}

function printAuditProgress(audits: AuditDataset | null, totalCases: number): void {
  console.log(color('┌─ AUDIT PROGRESS ' + '─'.repeat(52) + '┐', 'magenta'));
  
  if (!audits) {
    console.log(color('│', 'magenta') + '  No audits found. Run: npm run audit');
    console.log(color('└' + '─'.repeat(68) + '┘', 'magenta'));
    console.log();
    return;
  }
  
  const humanCompleted = audits.audits.filter(a => a.auditor === 'human').length;
  const llmCompleted = audits.audits.filter(a => a.auditor === 'gemini-3-pro').length;
  
  const humanPercent = totalCases > 0 ? humanCompleted / totalCases : 0;
  const llmPercent = totalCases > 0 ? llmCompleted / totalCases : 0;
  
  console.log(color('│', 'magenta') + `  Human audits:`);
  console.log(color('│', 'magenta') + `    ${progressBar(humanCompleted, totalCases)} ${humanCompleted}/${totalCases} (${formatPercent(humanPercent)})`);
  console.log(color('│', 'magenta'));
  console.log(color('│', 'magenta') + `  LLM audits (Gemini 3 Pro):`);
  console.log(color('│', 'magenta') + `    ${progressBar(llmCompleted, totalCases)} ${llmCompleted}/${totalCases} (${formatPercent(llmPercent)})`);
  console.log(color('│', 'magenta'));
  console.log(color('│', 'magenta') + `  Last updated: ${audits.lastUpdated}`);
  console.log(color('└' + '─'.repeat(68) + '┘', 'magenta'));
  console.log();
}

function printAgreementMetrics(report: AgreementReport | null): void {
  console.log(color('┌─ AGREEMENT METRICS (Human vs LLM) ' + '─'.repeat(33) + '┐', 'yellow'));
  
  if (!report) {
    console.log(color('│', 'yellow') + '  No agreement report found. Run: npm run agreement');
    console.log(color('└' + '─'.repeat(68) + '┘', 'yellow'));
    console.log();
    return;
  }
  
  const overall = report.overall;
  
  console.log(color('│', 'yellow') + `  Gwet AC1:       ${color(formatPercent(overall.gwetAC1), 'bright')} (${interpretAC1(overall.gwetAC1)})`);
  console.log(color('│', 'yellow') + `  Agreements:     ${overall.agreements}/${overall.total}`);
  console.log(color('│', 'yellow') + `  Disagreements:  ${overall.disagreements}`);
  console.log(color('│', 'yellow'));
  
  // Show top 3 categories by AC1
  const sortedCategories = Object.entries(report.byCategory)
    .sort(([, a], [, b]) => b.gwetAC1 - a.gwetAC1);
  
  console.log(color('│', 'yellow') + `  Best agreement categories:`);
  for (const [cat, metrics] of sortedCategories.slice(0, 3)) {
    console.log(color('│', 'yellow') + `    ${cat}: ${formatPercent(metrics.gwetAC1)}`);
  }
  
  if (sortedCategories.length > 3) {
    console.log(color('│', 'yellow'));
    console.log(color('│', 'yellow') + `  Worst agreement categories:`);
    for (const [cat, metrics] of sortedCategories.slice(-3).reverse()) {
      console.log(color('│', 'yellow') + `    ${cat}: ${formatPercent(metrics.gwetAC1)}`);
    }
  }
  
  console.log(color('└' + '─'.repeat(68) + '┘', 'yellow'));
  console.log();
}

function printLibraryPerformance(report: PerformanceReport | null): void {
  console.log(color('┌─ LIBRARY PERFORMANCE ' + '─'.repeat(47) + '┐', 'green'));
  
  if (!report) {
    console.log(color('│', 'green') + '  No performance report found. Run: npm run test:library');
    console.log(color('└' + '─'.repeat(68) + '┘', 'green'));
    console.log();
    return;
  }
  
  const overall = report.overall;
  
  console.log(color('│', 'green') + `  Accuracy:      ${color(formatPercent(overall.accuracy), 'bright')} (${interpretAccuracy(overall.accuracy)})`);
  console.log(color('│', 'green') + `  Correct:       ${overall.correct}/${overall.tested}`);
  console.log(color('│', 'green') + `  Failures:      ${overall.incorrect}`);
  console.log(color('│', 'green'));
  console.log(color('│', 'green') + `  Latency:`);
  console.log(color('│', 'green') + `    Average: ${report.latency.average.toFixed(0)}ms`);
  console.log(color('│', 'green') + `    P95:     ${report.latency.p95.toFixed(0)}ms`);
  console.log(color('│', 'green'));
  console.log(color('│', 'green') + `  By type:`);
  
  for (const [type, metrics] of Object.entries(report.byType)) {
    console.log(color('│', 'green') + `    ${type.padEnd(12)} ${formatPercent(metrics.accuracy)} (${metrics.tested} cases)`);
  }
  
  console.log(color('│', 'green'));
  console.log(color('│', 'green') + `  Provider: ${report.config.provider}`);
  console.log(color('│', 'green') + `  Council:  ${report.config.councilEnabled ? 'Enabled' : 'Disabled'}`);
  console.log(color('└' + '─'.repeat(68) + '┘', 'green'));
  console.log();
}

function printCommands(): void {
  console.log(color('┌─ AVAILABLE COMMANDS ' + '─'.repeat(48) + '┐', 'dim'));
  console.log(color('│', 'dim') + '  npm run generate:tests    Generate test cases (Claude Opus 4.5)');
  console.log(color('│', 'dim') + '  npm run audit             Audit cases as human');
  console.log(color('│', 'dim') + '  npm run audit:llm         Get LLM audits (Gemini 3 Pro)');
  console.log(color('│', 'dim') + '  npm run agreement         Calculate agreement metrics');
  console.log(color('│', 'dim') + '  npm run test:library      Test library against golden set');
  console.log(color('│', 'dim') + '  npm run generate:regression Generate Mocha tests');
  console.log(color('│', 'dim') + '  npm test                  Run regression tests');
  console.log(color('└' + '─'.repeat(68) + '┘', 'dim'));
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  // Load all data
  const dataset: TestCaseDataset | null = fs.existsSync(CASES_PATH)
    ? JSON.parse(fs.readFileSync(CASES_PATH, 'utf-8'))
    : null;
  
  const audits: AuditDataset | null = fs.existsSync(AUDITS_PATH)
    ? JSON.parse(fs.readFileSync(AUDITS_PATH, 'utf-8'))
    : null;
  
  const agreement: AgreementReport | null = fs.existsSync(AGREEMENT_PATH)
    ? JSON.parse(fs.readFileSync(AGREEMENT_PATH, 'utf-8'))
    : null;
  
  const performance: PerformanceReport | null = fs.existsSync(PERFORMANCE_PATH)
    ? JSON.parse(fs.readFileSync(PERFORMANCE_PATH, 'utf-8'))
    : null;
  
  // Print dashboard
  printHeader();
  printDatasetStats(dataset);
  printAuditProgress(audits, dataset?.stats.total || 0);
  printAgreementMetrics(agreement);
  printLibraryPerformance(performance);
  printCommands();
}

main().catch(console.error);

