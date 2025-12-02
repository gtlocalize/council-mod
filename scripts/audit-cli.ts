#!/usr/bin/env npx tsx
/**
 * QA Audit CLI
 * 
 * Interactive menu-driven interface for content moderation QA.
 * Supports auditing, disagreement review, statistics, and comments.
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
  AuditorType,
} from './types.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CASES_PATH = path.join(__dirname, '../test/data/generated-cases.json');
const AUDITS_PATH = path.join(__dirname, '../test/data/audits.json');

// =============================================================================
// COLORS & DISPLAY HELPERS
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
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

function color(text: string, c: keyof typeof colors): string {
  return `${colors[c]}${text}${colors.reset}`;
}

function clearScreen(): void {
  console.clear();
}

function boxText(text: string, width: number = 66): string[] {
  const lines: string[] = [];
  const textLines = text.split('\n');
  
  for (const line of textLines) {
    const chunks = line.match(new RegExp(`.{1,${width}}`, 'g')) || [''];
    lines.push(...chunks);
  }
  
  return lines;
}

function drawBox(title: string, content: string, width: number = 68): void {
  console.log(color('  ┌─ ' + title + ' ' + '─'.repeat(width - title.length - 5) + '┐', 'dim'));
  const lines = boxText(content, width - 4);
  for (const line of lines) {
    console.log(color('  │ ', 'dim') + line.padEnd(width - 4) + color(' │', 'dim'));
  }
  console.log(color('  └' + '─'.repeat(width - 2) + '┘', 'dim'));
}

// =============================================================================
// DATA MANAGEMENT
// =============================================================================

function seededShuffle<T>(array: T[], seed: number): T[] {
  const shuffled = [...array];
  let currentSeed = seed;
  
  const random = () => {
    currentSeed = (currentSeed * 1664525 + 1013904223) % 2**32;
    return currentSeed / 2**32;
  };
  
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled;
}

function loadCases(): TestCaseDataset | null {
  if (!fs.existsSync(CASES_PATH)) {
    console.error(color('\n  ❌ No test cases found. Run `npm run generate:tests` first.\n', 'red'));
    return null;
  }
  const dataset = JSON.parse(fs.readFileSync(CASES_PATH, 'utf-8'));
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
// READLINE HELPERS
// =============================================================================

let globalRl: readline.Interface | null = null;

function getReadline(): readline.Interface {
  if (!globalRl) {
    globalRl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }
  return globalRl;
}

function closeReadline(): void {
  if (globalRl) {
    globalRl.close();
    globalRl = null;
  }
}

async function prompt(question: string): Promise<string> {
  const rl = getReadline();
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function waitForKey(message: string = '  Press Enter to continue...'): Promise<void> {
  await prompt(color(message, 'dim'));
}

// =============================================================================
// MAIN MENU
// =============================================================================

function displayMainMenu(stats: { human: number; total: number; comments: number; disagreements: number }): void {
  clearScreen();
  console.log();
  console.log(color('  ╔════════════════════════════════════════════════════════════════╗', 'cyan'));
  console.log(color('  ║', 'cyan') + color('           CONTENT MODERATION QA SYSTEM                       ', 'bright') + color('║', 'cyan'));
  console.log(color('  ╚════════════════════════════════════════════════════════════════╝', 'cyan'));
  console.log();
  console.log(`    Progress: ${color(`${stats.human}/${stats.total}`, 'green')} cases audited (${((stats.human/stats.total)*100).toFixed(1)}%)`);
  console.log(`    Comments: ${color(String(stats.comments), 'yellow')} notes to review`);
  console.log(`    Disagreements: ${color(String(stats.disagreements), 'magenta')} cases`);
  console.log();
  console.log(color('  ─────────────────────────────────────────────────────────────────', 'dim'));
  console.log();
  console.log('    ' + color('[1]', 'green') + ' Start/Resume Audit');
  console.log('    ' + color('[2]', 'yellow') + ' Review Comments');
  console.log('    ' + color('[3]', 'magenta') + ' Review Disagreements');
  console.log('    ' + color('[4]', 'cyan') + ' View Statistics');
  console.log('    ' + color('[5]', 'blue') + ' Jump to Case');
  console.log('    ' + color('[6]', 'red') + ' Reset Human Audits');
  console.log();
  console.log('    ' + color('[Q]', 'dim') + ' Quit');
  console.log();
}

// =============================================================================
// AUDIT SESSION
// =============================================================================

function displayCase(testCase: TestCase, index: number, total: number, existingAudit?: Audit): void {
  console.log(color('═'.repeat(70), 'cyan'));
  console.log(color(`  CASE ${index + 1} of ${total}`, 'bright'));
  console.log(color('═'.repeat(70), 'cyan'));
  console.log();
  
  // Main text
  drawBox('TEXT', testCase.text);
  
  // Context if present
  if (testCase.context && testCase.context.length > 0) {
    console.log();
    console.log(color('  CONTEXT (previous messages, oldest first):', 'dim'));
    for (let i = 0; i < testCase.context.length; i++) {
      const ctx = testCase.context[i];
      if (typeof ctx === 'string') {
        console.log(color(`    [${i + 1}] `, 'dim') + ctx);
      } else {
        const speakerLabel = ctx.speaker === 'same' ? color('SAME USER', 'yellow') : color('OTHER', 'cyan');
        console.log(color(`    [${i + 1}] `, 'dim') + `(${speakerLabel}) ${ctx.text}`);
      }
    }
  }
  
  // Existing audit info
  if (existingAudit) {
    console.log();
    const actionColor = existingAudit.action === 'allow' ? 'green' : 
                       existingAudit.action === 'deny' ? 'red' : 'yellow';
    console.log(`  ${color('Your previous decision:', 'dim')} ${color(existingAudit.action.toUpperCase(), actionColor)}`);
    if (existingAudit.comment) {
      console.log(`  ${color('Comment:', 'dim')} ${existingAudit.comment}`);
    }
  }
  
  console.log();
}

function displayAuditOptions(): void {
  console.log(color('─'.repeat(70), 'dim'));
  console.log();
  console.log('    ' + color('[A]', 'green') + ' Allow      ' + 
              color('[D]', 'red') + ' Deny       ' + 
              color('[E]', 'yellow') + ' Escalate');
  console.log();
  console.log('    ' + color('[C]', 'magenta') + ' Add Comment    ' + 
              color('[B]', 'cyan') + ' Back       ' + 
              color('[S]', 'dim') + ' Skip');
  console.log();
  console.log('    ' + color('[M]', 'blue') + ' Main Menu      ' + 
              color('[Q]', 'dim') + ' Quit & Save');
  console.log();
}

async function runAuditSession(): Promise<void> {
  const dataset = loadCases();
  if (!dataset) return;
  
  const auditData = loadAudits();
  auditData.progress.human.total = dataset.cases.length;
  
  const humanAuditedIds = new Set(
    auditData.audits.filter(a => a.auditor === 'human').map(a => a.caseId)
  );
  
  let currentIndex = dataset.cases.findIndex(c => !humanAuditedIds.has(c.id));
  if (currentIndex === -1) currentIndex = 0;
  
  let lastAction: 'forward' | 'back' = 'forward';
  
  while (true) {
    const testCase = dataset.cases[currentIndex];
    if (!testCase) break;
    
    const existingAudit = auditData.audits.find(
      a => a.caseId === testCase.id && a.auditor === 'human'
    );
    
    // Auto-skip already audited when moving forward
    if (existingAudit && lastAction === 'forward' && !existingAudit.comment) {
      clearScreen();
      console.log(color(`\n  ⏭️  Case ${currentIndex + 1} already audited, skipping...\n`, 'dim'));
      currentIndex++;
      if (currentIndex >= dataset.cases.length) {
        console.log(color('  🎉 All cases audited!\n', 'green'));
        await waitForKey();
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
      continue;
    }
    
    clearScreen();
    displayCase(testCase, currentIndex, dataset.cases.length, existingAudit);
    displayAuditOptions();
    
    const input = await prompt(color('  Your decision: ', 'bright'));
    const key = input.toLowerCase().trim();
    
    switch (key) {
      case 'a':
      case 'd':
      case 'e': {
        const actionMap: Record<string, AuditAction> = { a: 'allow', d: 'deny', e: 'escalate' };
        const action = actionMap[key];
        
        // Remove existing and add new
        auditData.audits = auditData.audits.filter(
          a => !(a.caseId === testCase.id && a.auditor === 'human')
        );
        
        const audit: Audit = {
          caseId: testCase.id,
          auditor: 'human',
          action,
          timestamp: new Date().toISOString(),
        };
        
        // Optionally ask for comment on deny/escalate
        if (action !== 'allow') {
          console.log(color('\n  Add a comment? (Enter to skip, or type your note)', 'dim'));
          const comment = await prompt('  > ');
          if (comment.trim()) {
            audit.comment = comment.trim();
          }
        }
        
        auditData.audits.push(audit);
        auditData.progress.human.completed = auditData.audits.filter(a => a.auditor === 'human').length;
        saveAudits(auditData);
        
        currentIndex++;
        lastAction = 'forward';
        break;
      }
      
      case 'c': {
        // Add/edit comment on current case
        console.log(color('\n  Enter your comment:', 'dim'));
        const comment = await prompt('  > ');
        
        if (comment.trim()) {
          // Find or create audit entry
          let audit = auditData.audits.find(
            a => a.caseId === testCase.id && a.auditor === 'human'
          );
          
          if (audit) {
            audit.comment = comment.trim();
          } else {
            // Create a placeholder audit with comment (will need to set action later)
            console.log(color('\n  Please also make a decision (A/D/E):', 'yellow'));
            const decisionInput = await prompt('  > ');
            const decisionKey = decisionInput.toLowerCase().trim();
            
            if (['a', 'd', 'e'].includes(decisionKey)) {
              const actionMap: Record<string, AuditAction> = { a: 'allow', d: 'deny', e: 'escalate' };
              audit = {
                caseId: testCase.id,
                auditor: 'human',
                action: actionMap[decisionKey],
                comment: comment.trim(),
                timestamp: new Date().toISOString(),
              };
              auditData.audits.push(audit);
              auditData.progress.human.completed = auditData.audits.filter(a => a.auditor === 'human').length;
              currentIndex++;
              lastAction = 'forward';
            } else {
              console.log(color('\n  ⚠️  Invalid decision, comment not saved.\n', 'yellow'));
              await waitForKey();
            }
          }
          saveAudits(auditData);
        }
        break;
      }
      
      case 'b':
        if (currentIndex > 0) {
          currentIndex--;
          lastAction = 'back';
        }
        break;
      
      case 's':
        currentIndex++;
        lastAction = 'forward';
        break;
      
      case 'm':
        return; // Return to main menu
      
      case 'q':
        saveAudits(auditData);
        console.log(color('\n  ✅ Progress saved. Goodbye!\n', 'green'));
        process.exit(0);
      
      default:
        console.log(color('\n  ⚠️  Invalid input. Use A/D/E/C/B/S/M/Q\n', 'yellow'));
        await waitForKey();
    }
    
    if (currentIndex >= dataset.cases.length) {
      clearScreen();
      console.log(color('\n  🎉 All cases audited!\n', 'green'));
      await waitForKey();
      return;
    }
  }
}

// =============================================================================
// COMMENTS REVIEW
// =============================================================================

async function reviewComments(): Promise<void> {
  const dataset = loadCases();
  const auditData = loadAudits();
  
  if (!dataset) return;
  
  const auditsWithComments = auditData.audits.filter(a => a.auditor === 'human' && a.comment);
  
  if (auditsWithComments.length === 0) {
    clearScreen();
    console.log(color('\n  📝 No comments found.\n', 'dim'));
    await waitForKey();
    return;
  }
  
  let index = 0;
  
  while (index < auditsWithComments.length) {
    const audit = auditsWithComments[index];
    const testCase = dataset.cases.find(c => c.id === audit.caseId);
    
    clearScreen();
    console.log(color('\n  📝 COMMENTS REVIEW', 'bright'));
    console.log(color(`  ${index + 1} of ${auditsWithComments.length}`, 'dim'));
    console.log();
    
    if (testCase) {
      drawBox('TEXT', testCase.text);
    }
    
    console.log();
    const actionColor = audit.action === 'allow' ? 'green' : audit.action === 'deny' ? 'red' : 'yellow';
    console.log(`  Decision: ${color(audit.action.toUpperCase(), actionColor)}`);
    console.log();
    console.log(color('  ┌─ COMMENT ' + '─'.repeat(57) + '┐', 'magenta'));
    const commentLines = boxText(audit.comment || '', 64);
    for (const line of commentLines) {
      console.log(color('  │ ', 'magenta') + line.padEnd(64) + color(' │', 'magenta'));
    }
    console.log(color('  └' + '─'.repeat(66) + '┘', 'magenta'));
    
    console.log();
    console.log('    ' + color('[N]', 'cyan') + ' Next    ' + 
                color('[P]', 'cyan') + ' Previous    ' +
                color('[E]', 'yellow') + ' Edit Comment    ' +
                color('[D]', 'red') + ' Delete Comment');
    console.log('    ' + color('[M]', 'blue') + ' Main Menu');
    console.log();
    
    const input = await prompt('  > ');
    const key = input.toLowerCase().trim();
    
    switch (key) {
      case 'n':
      case '':
        index++;
        break;
      case 'p':
        if (index > 0) index--;
        break;
      case 'e': {
        console.log(color('\n  Enter new comment:', 'dim'));
        const newComment = await prompt('  > ');
        if (newComment.trim()) {
          audit.comment = newComment.trim();
          saveAudits(auditData);
          console.log(color('  ✅ Comment updated.\n', 'green'));
          await waitForKey();
        }
        break;
      }
      case 'd': {
        delete audit.comment;
        saveAudits(auditData);
        auditsWithComments.splice(index, 1);
        console.log(color('  ✅ Comment deleted.\n', 'green'));
        await waitForKey();
        if (index >= auditsWithComments.length && index > 0) index--;
        break;
      }
      case 'm':
        return;
    }
    
    if (auditsWithComments.length === 0) {
      console.log(color('\n  📝 No more comments.\n', 'dim'));
      await waitForKey();
      return;
    }
  }
}

// =============================================================================
// DISAGREEMENT REVIEW
// =============================================================================

interface Disagreement {
  caseId: string;
  testCase: TestCase;
  votes: Record<string, { action: string; reasoning?: string }>;
  humanVote: string;
}

async function reviewDisagreements(): Promise<void> {
  const dataset = loadCases();
  const auditData = loadAudits();
  
  if (!dataset) return;
  
  // Build maps by auditor
  const byAuditor: Record<string, Map<string, Audit>> = {};
  auditData.audits.forEach(a => {
    if (!byAuditor[a.auditor]) byAuditor[a.auditor] = new Map();
    byAuditor[a.auditor].set(a.caseId, a);
  });
  
  const humanMap = byAuditor['human'];
  if (!humanMap || humanMap.size === 0) {
    clearScreen();
    console.log(color('\n  ❌ No human audits found. Complete some audits first.\n', 'red'));
    await waitForKey();
    return;
  }
  
  const llmAuditors = Object.keys(byAuditor).filter(a => a !== 'human');
  
  // Find disagreements
  const disagreements: Disagreement[] = [];
  
  for (const c of dataset.cases) {
    const humanAudit = humanMap.get(c.id);
    if (!humanAudit) continue;
    
    const votes: Record<string, { action: string; reasoning?: string }> = {
      human: { action: humanAudit.action }
    };
    
    let hasDisagreement = false;
    
    for (const auditor of llmAuditors) {
      const audit = byAuditor[auditor]?.get(c.id);
      if (audit) {
        votes[auditor] = { action: audit.action, reasoning: audit.reasoning };
        if (audit.action !== humanAudit.action) {
          hasDisagreement = true;
        }
      }
    }
    
    if (hasDisagreement) {
      disagreements.push({
        caseId: c.id,
        testCase: c,
        votes,
        humanVote: humanAudit.action,
      });
    }
  }
  
  if (disagreements.length === 0) {
    clearScreen();
    console.log(color('\n  ✅ No disagreements! All auditors agree on reviewed cases.\n', 'green'));
    await waitForKey();
    return;
  }
  
  // Filter menu
  clearScreen();
  console.log(color('\n  ⚖️  DISAGREEMENT REVIEW', 'bright'));
  console.log(color(`  Found ${disagreements.length} cases with disagreement\n`, 'dim'));
  
  console.log('    ' + color('[1]', 'cyan') + ` All disagreements (${disagreements.length})`);
  
  const humanAllowLlmDeny = disagreements.filter(d => 
    d.humanVote === 'allow' && Object.entries(d.votes).some(([k, v]) => k !== 'human' && v.action === 'deny')
  );
  console.log('    ' + color('[2]', 'green') + ` Human ALLOW, LLM(s) DENY (${humanAllowLlmDeny.length})`);
  
  const humanDenyLlmAllow = disagreements.filter(d => 
    d.humanVote === 'deny' && Object.entries(d.votes).some(([k, v]) => k !== 'human' && v.action === 'allow')
  );
  console.log('    ' + color('[3]', 'red') + ` Human DENY, LLM(s) ALLOW (${humanDenyLlmAllow.length})`);
  
  console.log();
  console.log('    ' + color('[M]', 'blue') + ' Main Menu');
  console.log();
  
  const filterInput = await prompt('  Select filter: ');
  
  let filtered: Disagreement[];
  switch (filterInput.trim()) {
    case '1': filtered = disagreements; break;
    case '2': filtered = humanAllowLlmDeny; break;
    case '3': filtered = humanDenyLlmAllow; break;
    default: return;
  }
  
  if (filtered.length === 0) {
    console.log(color('\n  No cases match this filter.\n', 'yellow'));
    await waitForKey();
    return;
  }
  
  // Review loop
  let index = 0;
  
  while (index < filtered.length) {
    const d = filtered[index];
    
    clearScreen();
    console.log(color('\n  ⚖️  DISAGREEMENT REVIEW', 'bright'));
    console.log(color(`  Case ${index + 1} of ${filtered.length}`, 'dim'));
    console.log();
    
    drawBox('TEXT', d.testCase.text);
    
    if (d.testCase.context && d.testCase.context.length > 0) {
      console.log();
      console.log(color('  CONTEXT:', 'dim'));
      for (let i = 0; i < d.testCase.context.length; i++) {
        const ctx = d.testCase.context[i];
        const text = typeof ctx === 'string' ? ctx : ctx.text;
        console.log(`    [${i + 1}] ${text.substring(0, 60)}${text.length > 60 ? '...' : ''}`);
      }
    }
    
    console.log();
    console.log(color('  VOTES:', 'cyan'));
    for (const [auditor, vote] of Object.entries(d.votes)) {
      const voteColor = vote.action === 'allow' ? 'green' : vote.action === 'deny' ? 'red' : 'yellow';
      const marker = auditor === 'human' ? color(' ← YOU', 'bright') : '';
      console.log(`    ${auditor.padEnd(20)} ${color(vote.action.toUpperCase().padEnd(10), voteColor)}${marker}`);
      if (vote.reasoning && auditor !== 'human') {
        console.log(color(`      "${vote.reasoning.substring(0, 60)}${vote.reasoning.length > 60 ? '...' : ''}"`, 'dim'));
      }
    }
    
    console.log();
    console.log('    ' + color('[A]', 'green') + ' Change to ALLOW    ' +
                color('[D]', 'red') + ' Change to DENY    ' +
                color('[E]', 'yellow') + ' Change to ESCALATE');
    console.log('    ' + color('[N]', 'cyan') + ' Next (keep)        ' +
                color('[P]', 'cyan') + ' Previous          ' +
                color('[C]', 'magenta') + ' Add Comment');
    console.log('    ' + color('[M]', 'blue') + ' Main Menu');
    console.log();
    
    const input = await prompt('  Your decision: ');
    const key = input.toLowerCase().trim();
    
    switch (key) {
      case 'n':
      case '':
        index++;
        break;
      case 'p':
        if (index > 0) index--;
        break;
      case 'a':
      case 'd':
      case 'e': {
        const actionMap: Record<string, AuditAction> = { a: 'allow', d: 'deny', e: 'escalate' };
        const newAction = actionMap[key];
        
        const existingIndex = auditData.audits.findIndex(
          a => a.caseId === d.caseId && a.auditor === 'human'
        );
        
        if (existingIndex >= 0) {
          auditData.audits[existingIndex].action = newAction;
          auditData.audits[existingIndex].timestamp = new Date().toISOString();
        }
        
        saveAudits(auditData);
        d.votes['human'].action = newAction;
        d.humanVote = newAction;
        
        console.log(color(`\n  ✅ Changed to ${newAction.toUpperCase()}\n`, 'green'));
        await new Promise(r => setTimeout(r, 400));
        index++;
        break;
      }
      case 'c': {
        console.log(color('\n  Enter comment:', 'dim'));
        const comment = await prompt('  > ');
        if (comment.trim()) {
          const auditIndex = auditData.audits.findIndex(
            a => a.caseId === d.caseId && a.auditor === 'human'
          );
          if (auditIndex >= 0) {
            auditData.audits[auditIndex].comment = comment.trim();
            saveAudits(auditData);
            console.log(color('  ✅ Comment saved.\n', 'green'));
          }
        }
        await waitForKey();
        break;
      }
      case 'm':
        return;
    }
  }
  
  console.log(color('\n  ✅ Finished reviewing disagreements.\n', 'green'));
  await waitForKey();
}

// =============================================================================
// STATISTICS
// =============================================================================

async function viewStatistics(): Promise<void> {
  const dataset = loadCases();
  const auditData = loadAudits();
  
  if (!dataset) return;
  
  clearScreen();
  console.log(color('\n  📊 AUDIT STATISTICS', 'bright'));
  console.log(color('  ═'.repeat(35), 'cyan'));
  console.log();
  
  // Overall progress
  const humanAudits = auditData.audits.filter(a => a.auditor === 'human');
  const total = dataset.cases.length;
  
  console.log(color('  OVERALL PROGRESS', 'cyan'));
  console.log(`    Total cases:      ${total}`);
  console.log(`    Human audited:    ${humanAudits.length} (${((humanAudits.length/total)*100).toFixed(1)}%)`);
  console.log();
  
  // By auditor
  const auditorCounts: Record<string, { allow: number; deny: number; escalate: number }> = {};
  
  for (const audit of auditData.audits) {
    if (!auditorCounts[audit.auditor]) {
      auditorCounts[audit.auditor] = { allow: 0, deny: 0, escalate: 0 };
    }
    auditorCounts[audit.auditor][audit.action]++;
  }
  
  console.log(color('  BY AUDITOR', 'cyan'));
  console.log('    ' + 'Auditor'.padEnd(22) + 'Allow'.padEnd(8) + 'Deny'.padEnd(8) + 'Escalate'.padEnd(10) + 'Total');
  console.log('    ' + '─'.repeat(56));
  
  for (const [auditor, counts] of Object.entries(auditorCounts)) {
    const total = counts.allow + counts.deny + counts.escalate;
    console.log(
      '    ' +
      auditor.padEnd(22) +
      color(String(counts.allow).padEnd(8), 'green') +
      color(String(counts.deny).padEnd(8), 'red') +
      color(String(counts.escalate).padEnd(10), 'yellow') +
      String(total)
    );
  }
  
  // Comments
  const comments = auditData.audits.filter(a => a.comment);
  console.log();
  console.log(color('  COMMENTS', 'cyan'));
  console.log(`    Total comments:   ${comments.length}`);
  
  // Agreement rates (if multiple auditors)
  const auditors = Object.keys(auditorCounts);
  if (auditors.includes('human') && auditors.length > 1) {
    console.log();
    console.log(color('  AGREEMENT WITH HUMAN', 'cyan'));
    
    const humanMap = new Map(auditData.audits.filter(a => a.auditor === 'human').map(a => [a.caseId, a]));
    
    for (const auditor of auditors.filter(a => a !== 'human')) {
      const llmAudits = auditData.audits.filter(a => a.auditor === auditor);
      let agree = 0;
      let compared = 0;
      
      for (const llmAudit of llmAudits) {
        const humanAudit = humanMap.get(llmAudit.caseId);
        if (humanAudit) {
          compared++;
          if (humanAudit.action === llmAudit.action) agree++;
        }
      }
      
      if (compared > 0) {
        const rate = ((agree / compared) * 100).toFixed(1);
        console.log(`    ${auditor.padEnd(22)} ${rate}% (${agree}/${compared})`);
      }
    }
  }
  
  console.log();
  await waitForKey();
}

// =============================================================================
// JUMP TO CASE
// =============================================================================

async function jumpToCase(): Promise<void> {
  const dataset = loadCases();
  if (!dataset) return;
  
  clearScreen();
  console.log(color('\n  🔍 JUMP TO CASE', 'bright'));
  console.log();
  console.log(`  Total cases: ${dataset.cases.length}`);
  console.log();
  
  const input = await prompt('  Enter case number (1-' + dataset.cases.length + '): ');
  const num = parseInt(input.trim(), 10);
  
  if (isNaN(num) || num < 1 || num > dataset.cases.length) {
    console.log(color('\n  ⚠️  Invalid case number.\n', 'yellow'));
    await waitForKey();
    return;
  }
  
  // Start audit from that case
  const auditData = loadAudits();
  
  const testCase = dataset.cases[num - 1];
  const existingAudit = auditData.audits.find(
    a => a.caseId === testCase.id && a.auditor === 'human'
  );
  
  clearScreen();
  displayCase(testCase, num - 1, dataset.cases.length, existingAudit);
  displayAuditOptions();
  
  const decision = await prompt(color('  Your decision (or M for menu): ', 'bright'));
  const key = decision.toLowerCase().trim();
  
  if (['a', 'd', 'e'].includes(key)) {
    const actionMap: Record<string, AuditAction> = { a: 'allow', d: 'deny', e: 'escalate' };
    const action = actionMap[key];
    
    auditData.audits = auditData.audits.filter(
      a => !(a.caseId === testCase.id && a.auditor === 'human')
    );
    
    const audit: Audit = {
      caseId: testCase.id,
      auditor: 'human',
      action,
      timestamp: new Date().toISOString(),
    };
    
    if (action !== 'allow') {
      console.log(color('\n  Add a comment? (Enter to skip)', 'dim'));
      const comment = await prompt('  > ');
      if (comment.trim()) {
        audit.comment = comment.trim();
      }
    }
    
    auditData.audits.push(audit);
    saveAudits(auditData);
    console.log(color(`\n  ✅ Recorded: ${action.toUpperCase()}\n`, 'green'));
    await waitForKey();
  }
}

// =============================================================================
// RESET
// =============================================================================

async function resetAudits(): Promise<void> {
  clearScreen();
  console.log(color('\n  ⚠️  RESET HUMAN AUDITS', 'red'));
  console.log();
  console.log('  This will delete ALL your human audit decisions.');
  console.log('  LLM audits will be preserved.');
  console.log();
  
  const confirm = await prompt(color('  Type "yes" to confirm: ', 'red'));
  
  if (confirm.toLowerCase().trim() === 'yes') {
    const auditData = loadAudits();
    auditData.audits = auditData.audits.filter(a => a.auditor !== 'human');
    auditData.progress.human.completed = 0;
    saveAudits(auditData);
    console.log(color('\n  ✅ Human audits reset.\n', 'green'));
  } else {
    console.log(color('\n  Cancelled.\n', 'dim'));
  }
  
  await waitForKey();
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  while (true) {
    const dataset = loadCases();
    const auditData = loadAudits();
    
    const humanAudits = auditData.audits.filter(a => a.auditor === 'human');
    const comments = auditData.audits.filter(a => a.comment).length;
    
    // Count disagreements
    const humanMap = new Map(humanAudits.map(a => [a.caseId, a]));
    const llmAuditors = [...new Set(auditData.audits.filter(a => a.auditor !== 'human').map(a => a.auditor))];
    let disagreements = 0;
    
    for (const [caseId, humanAudit] of humanMap) {
      for (const llmAuditor of llmAuditors) {
        const llmAudit = auditData.audits.find(a => a.caseId === caseId && a.auditor === llmAuditor);
        if (llmAudit && llmAudit.action !== humanAudit.action) {
          disagreements++;
          break;
        }
      }
    }
    
    displayMainMenu({
      human: humanAudits.length,
      total: dataset?.cases.length || 0,
      comments,
      disagreements,
    });
    
    const input = await prompt('  Select option: ');
    const choice = input.toLowerCase().trim();
    
    switch (choice) {
      case '1':
        await runAuditSession();
        break;
      case '2':
        await reviewComments();
        break;
      case '3':
        await reviewDisagreements();
        break;
      case '4':
        await viewStatistics();
        break;
      case '5':
        await jumpToCase();
        break;
      case '6':
        await resetAudits();
        break;
      case 'q':
        clearScreen();
        console.log(color('\n  👋 Goodbye!\n', 'green'));
        closeReadline();
        process.exit(0);
      default:
        console.log(color('\n  ⚠️  Invalid option.\n', 'yellow'));
        await waitForKey();
    }
  }
}

main().catch(console.error);
