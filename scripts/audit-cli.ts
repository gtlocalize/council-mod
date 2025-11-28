#!/usr/bin/env npx tsx
/**
 * Audit CLI
 * 
 * Interactive terminal interface for auditing test cases.
 * Supports save/resume, keyboard shortcuts, and progress tracking.
 * 
 * Usage: npm run audit
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
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

const CASES_PATH = path.join(__dirname, '../test/data/generated-cases.json');
const AUDITS_PATH = path.join(__dirname, '../test/data/audits.json');

// ANSI colors
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
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

function color(text: string, c: keyof typeof colors): string {
  return `${colors[c]}${text}${colors.reset}`;
}

// =============================================================================
// DATA LOADING
// =============================================================================

/**
 * Seeded shuffle for deterministic randomization.
 * Same seed = same order (so resuming works correctly).
 */
function seededShuffle<T>(array: T[], seed: number): T[] {
  const shuffled = [...array];
  let currentSeed = seed;
  
  // Simple LCG (Linear Congruential Generator)
  const random = () => {
    currentSeed = (currentSeed * 1664525 + 1013904223) % 2**32;
    return currentSeed / 2**32;
  };
  
  // Fisher-Yates shuffle with seeded random
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled;
}

function loadCases(): TestCaseDataset | null {
  if (!fs.existsSync(CASES_PATH)) {
    console.error(color('\n❌ No test cases found. Run `npm run generate:tests` first.\n', 'red'));
    return null;
  }
  const dataset = JSON.parse(fs.readFileSync(CASES_PATH, 'utf-8'));
  
  // Shuffle cases to prevent order bias in human auditing
  // Use a fixed seed so the order is deterministic and resume works
  dataset.cases = seededShuffle(dataset.cases, 42);
  
  return dataset;
}

function loadAudits(): AuditDataset {
  if (fs.existsSync(AUDITS_PATH)) {
    return JSON.parse(fs.readFileSync(AUDITS_PATH, 'utf-8'));
  }
  return {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    audits: [],
    progress: {
      human: { completed: 0, total: 0 },
      llm: { completed: 0, total: 0 },
    },
  };
}

function saveAudits(audits: AuditDataset): void {
  const dir = path.dirname(AUDITS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  audits.lastUpdated = new Date().toISOString();
  fs.writeFileSync(AUDITS_PATH, JSON.stringify(audits, null, 2));
}

// =============================================================================
// DISPLAY
// =============================================================================

function clearScreen(): void {
  console.clear();
}

function displayHeader(current: number, total: number, auditData: AuditDataset): void {
  console.log(color('═'.repeat(70), 'cyan'));
  console.log(color('  CONTENT MODERATION AUDIT CLI', 'bright'));
  console.log(color('═'.repeat(70), 'cyan'));
  
  const humanAudits = auditData.audits.filter(a => a.auditor === 'human').length;
  const progress = ((humanAudits / total) * 100).toFixed(1);
  
  console.log(`\n  Progress: ${color(`${humanAudits}/${total}`, 'green')} (${progress}%)`);
  console.log(`  Current:  ${color(`#${current + 1}`, 'yellow')}`);
  console.log();
}

function displayCase(testCase: TestCase): void {
  console.log(color('─'.repeat(70), 'dim'));
  console.log();
  
  // REMOVED: ID (contains category: "hate_speech-positive-en-...")
  // REMOVED: Language (obvious from reading the text)
  // REMOVED: Category (biases toward expected answer)
  // REMOVED: Type (biases toward positive/negative/edge)
  // REMOVED: Generation reasoning (literally tells the answer!)
  
  // Text content - ONLY thing the auditor sees
  console.log(color('  TEXT:', 'bright'));
  console.log(color('  ┌' + '─'.repeat(66) + '┐', 'dim'));
  
  const lines = testCase.text.split('\n');
  for (const line of lines) {
    // Wrap long lines
    const chunks = line.match(/.{1,64}/g) || [''];
    for (const chunk of chunks) {
      console.log(color('  │ ', 'dim') + chunk.padEnd(64) + color(' │', 'dim'));
    }
  }
  
  console.log(color('  └' + '─'.repeat(66) + '┘', 'dim'));
  
  // Context if present
  if (testCase.context && testCase.context.length > 0) {
    console.log();
    console.log(color('  CONTEXT (previous messages):', 'dim'));
    for (let i = 0; i < testCase.context.length; i++) {
      console.log(color(`    [${i + 1}] `, 'dim') + testCase.context[i]);
    }
  }
  
  console.log();
}

function displayOptions(): void {
  console.log(color('─'.repeat(70), 'dim'));
  console.log();
  console.log('  ' + color('[A]', 'green') + ' Allow    ' + 
              color('[D]', 'red') + ' Deny     ' + 
              color('[E]', 'yellow') + ' Escalate');
  console.log();
  console.log('  ' + color('[S]', 'cyan') + ' Skip     ' + 
              color('[B]', 'cyan') + ' Back     ' + 
              color('[Q]', 'dim') + ' Quit & Save');
  console.log();
}

function displayExistingAudit(audit: Audit | undefined): void {
  if (audit) {
    const actionColor = audit.action === 'allow' ? 'green' : 
                       audit.action === 'deny' ? 'red' : 'yellow';
    console.log(`  ${color('Previous audit:', 'dim')} ${color(audit.action.toUpperCase(), actionColor)}`);
    if (audit.reasoning) {
      console.log(`  ${color('Reasoning:', 'dim')} ${audit.reasoning}`);
    }
    console.log();
  }
}

// =============================================================================
// INPUT HANDLING
// =============================================================================

function createReadline(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function getAuditDecision(
  rl: readline.Interface,
  testCase: TestCase,
  existingAudit: Audit | undefined
): Promise<{ action: AuditAction | 'skip' | 'back' | 'quit'; reasoning?: string }> {
  displayExistingAudit(existingAudit);
  displayOptions();
  
  const input = await prompt(rl, color('  Your decision: ', 'bright'));
  const key = input.toLowerCase().trim();
  
  switch (key) {
    case 'a':
    case 'allow':
      return { action: 'allow' };
    case 'd':
    case 'deny':
      return { action: 'deny' };
    case 'e':
    case 'escalate':
      return { action: 'escalate' };
    case 's':
    case 'skip':
      return { action: 'skip' };
    case 'b':
    case 'back':
      return { action: 'back' };
    case 'q':
    case 'quit':
      return { action: 'quit' };
    default:
      console.log(color('\n  ⚠️  Invalid input. Use A/D/E/S/B/Q\n', 'yellow'));
      return getAuditDecision(rl, testCase, existingAudit);
  }
}

// =============================================================================
// MAIN AUDIT LOOP
// =============================================================================

async function runAuditSession(): Promise<void> {
  const dataset = loadCases();
  if (!dataset) return;
  
  const auditData = loadAudits();
  auditData.progress.human.total = dataset.cases.length;
  
  // Find first unaudited case
  const humanAuditedIds = new Set(
    auditData.audits
      .filter(a => a.auditor === 'human')
      .map(a => a.caseId)
  );
  
  let currentIndex = dataset.cases.findIndex(c => !humanAuditedIds.has(c.id));
  if (currentIndex === -1) currentIndex = 0;
  
  const rl = createReadline();
  
  // Enable raw mode for better key handling
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  
  console.log(color('\n  Starting audit session...', 'green'));
  console.log(color('  Progress is auto-saved after each decision.\n', 'dim'));
  await prompt(rl, color('  Press Enter to begin...', 'dim'));
  
  while (true) {
    const testCase = dataset.cases[currentIndex];
    if (!testCase) break;
    
    // Auto-skip already audited cases (unless going back)
    const existingAudit = auditData.audits.find(
      a => a.caseId === testCase.id && a.auditor === 'human'
    );
    
    // If already audited and we're moving forward, skip it
    if (existingAudit && currentIndex >= 0) {
      // Show briefly that we're skipping
      clearScreen();
      displayHeader(currentIndex, dataset.cases.length, auditData);
      console.log(color('\n  ⏭️  Case already audited, skipping...\n', 'dim'));
      currentIndex++;
      await new Promise(resolve => setTimeout(resolve, 300));  // Brief pause
      continue;
    }
    
    clearScreen();
    displayHeader(currentIndex, dataset.cases.length, auditData);
    displayCase(testCase);
    
    const decision = await getAuditDecision(rl, testCase, existingAudit);
    
    if (decision.action === 'quit') {
      saveAudits(auditData);
      console.log(color('\n  ✅ Progress saved. Goodbye!\n', 'green'));
      break;
    }
    
    if (decision.action === 'back') {
      if (currentIndex > 0) currentIndex--;
      continue;
    }
    
    if (decision.action === 'skip') {
      currentIndex++;
      continue;
    }
    
    // Record the audit
    const audit: Audit = {
      caseId: testCase.id,
      auditor: 'human',
      action: decision.action,
      reasoning: decision.reasoning,
      timestamp: new Date().toISOString(),
    };
    
    // Remove existing audit for this case if any
    auditData.audits = auditData.audits.filter(
      a => !(a.caseId === testCase.id && a.auditor === 'human')
    );
    auditData.audits.push(audit);
    
    // Update progress
    auditData.progress.human.completed = auditData.audits.filter(
      a => a.auditor === 'human'
    ).length;
    
    // Auto-save
    saveAudits(auditData);
    
    // Move to next case
    currentIndex++;
    
    // Check if done
    if (currentIndex >= dataset.cases.length) {
      clearScreen();
      console.log(color('\n  🎉 All cases audited!\n', 'green'));
      console.log(`  Total audited: ${auditData.progress.human.completed}`);
      console.log(`  Data saved to: ${AUDITS_PATH}\n`);
      break;
    }
  }
  
  rl.close();
}

// =============================================================================
// ENTRY POINT
// =============================================================================

async function main(): Promise<void> {
  console.clear();
  console.log(color('\n  CONTENT MODERATION AUDIT CLI', 'bright'));
  console.log(color('  ─────────────────────────────\n', 'dim'));
  
  const args = process.argv.slice(2);
  
  if (args.includes('--stats')) {
    // Show stats only
    const auditData = loadAudits();
    const dataset = loadCases();
    if (!dataset) return;
    
    console.log(`  Total cases: ${dataset.cases.length}`);
    console.log(`  Human audits: ${auditData.progress.human.completed}`);
    console.log(`  LLM audits: ${auditData.progress.llm.completed}`);
    console.log(`  Remaining: ${dataset.cases.length - auditData.progress.human.completed}`);
    return;
  }
  
  if (args.includes('--reset')) {
    // Reset audits
    const confirm = await new Promise<string>((resolve) => {
      const rl = createReadline();
      rl.question(color('  ⚠️  Reset all human audits? (yes/no): ', 'yellow'), (answer) => {
        rl.close();
        resolve(answer);
      });
    });
    
    if (confirm.toLowerCase() === 'yes') {
      const auditData = loadAudits();
      auditData.audits = auditData.audits.filter(a => a.auditor !== 'human');
      auditData.progress.human.completed = 0;
      saveAudits(auditData);
      console.log(color('  ✅ Human audits reset.\n', 'green'));
    }
    return;
  }
  
  // Run audit session
  await runAuditSession();
}

main().catch(console.error);

