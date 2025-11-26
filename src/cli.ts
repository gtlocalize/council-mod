#!/usr/bin/env node
/**
 * Content Moderation Test CLI
 * 
 * Usage:
 *   npx ts-node src/cli.ts "your text here"
 *   npx ts-node src/cli.ts --interactive
 *   
 * Set OPENAI_API_KEY env var for full API-based moderation
 */

import { Moderator, ExtendedModerationResult } from './moderator';
import { normalizer } from './normalizer';

// ANSI color codes
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
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

function colorize(text: string, color: keyof typeof colors): string {
  return `${colors[color]}${text}${colors.reset}`;
}

function severityColor(severity: number): string {
  if (severity >= 0.7) return 'red';
  if (severity >= 0.4) return 'yellow';
  return 'green';
}

function actionColor(action: string): keyof typeof colors {
  switch (action) {
    case 'deny': return 'red';
    case 'escalate': return 'yellow';
    case 'allow': return 'green';
    default: return 'white';
  }
}

function actionEmoji(action: string): string {
  switch (action) {
    case 'deny': return '⛔';
    case 'escalate': return '⚠️';
    case 'allow': return '✅';
    default: return '❓';
  }
}

function tierColor(tier: string): keyof typeof colors {
  switch (tier) {
    case 'local': return 'green';
    case 'api': return 'cyan';
    case 'council': return 'yellow';
    case 'human': return 'magenta';
    default: return 'white';
  }
}

function tierEmoji(tier: string): string {
  switch (tier) {
    case 'local': return '⚡';
    case 'api': return '🌐';
    case 'council': return '🏛️';
    case 'human': return '👤';
    default: return '❓';
  }
}

async function analyzeText(text: string, moderator: Moderator) {
  console.log('\n' + '='.repeat(70));
  console.log(colorize('INPUT:', 'bright'), text);
  console.log('='.repeat(70));
  
  // Show normalization first
  const normResult = normalizer.normalize(text);
  if (normResult.normalized !== text.toLowerCase()) {
    console.log(colorize('\n📝 NORMALIZATION:', 'cyan'));
    console.log(`   Original:   "${text}"`);
    console.log(`   Normalized: "${normResult.normalized}"`);
    if (normalizer.hasObfuscation(text)) {
      console.log(colorize('   ⚠️  Obfuscation detected!', 'yellow'));
    }
  }
  
  // Run full moderation
  console.log(colorize('\n🔍 ANALYZING...', 'dim'));
  const result = await moderator.moderate(text);
  
  // Results header
  console.log(colorize('\n📊 MODERATION RESULT:', 'bright'));
  
  // Flagged status
  const flaggedStr = result.flagged 
    ? colorize('⛔ FLAGGED', 'red')
    : colorize('✅ CLEAN', 'green');
  console.log(`   Status: ${flaggedStr}`);
  
  // Severity
  const sevColor = severityColor(result.severity);
  console.log(`   Severity: ${colorize((result.severity * 100).toFixed(1) + '%', sevColor as keyof typeof colors)}`);
  
  // Final action (allow / deny / escalate)
  const action = result.action || 'allow';
  const actColor = actionColor(action);
  console.log(`   Action: ${actionEmoji(action)} ${colorize(action.toUpperCase(), actColor)}`);
  
  // Confidence
  console.log(`   Confidence: ${(result.confidence * 100).toFixed(1)}%`);
  
  // Category scores
  console.log(colorize('\n📋 CATEGORY SCORES:', 'cyan'));
  const sortedCategories = Object.entries(result.categories)
    .filter(([, score]) => score !== undefined && score > 0)
    .sort(([, a], [, b]) => (b || 0) - (a || 0));
  
  if (sortedCategories.length === 0) {
    console.log('   No categories flagged');
  } else {
    for (const [category, score] of sortedCategories) {
      const bar = '█'.repeat(Math.round((score || 0) * 20));
      const empty = '░'.repeat(20 - Math.round((score || 0) * 20));
      const scoreColor = severityColor(score || 0);
      console.log(`   ${category.padEnd(20)} ${colorize(bar, scoreColor as keyof typeof colors)}${empty} ${((score || 0) * 100).toFixed(1)}%`);
    }
  }
  
  // Context factors
  console.log(colorize('\n🎯 CONTEXT ANALYSIS:', 'magenta'));
  console.log(`   Intent:          ${result.contextFactors.intent}`);
  console.log(`   Target:          ${result.contextFactors.target}`);
  console.log(`   Sentiment:       ${result.contextFactors.sentiment}`);
  console.log(`   Is Reclamation:  ${result.contextFactors.isReclamation ? '✓' : '✗'}`);
  console.log(`   Is Educational:  ${result.contextFactors.isEducational ? '✓' : '✗'}`);
  console.log(`   Is Quoted:       ${result.contextFactors.isQuoted ? '✓' : '✗'}`);
  console.log(`   Self-Reference:  ${result.contextFactors.isSelfReferential ? '✓' : '✗'}`);
  
  // Flagged spans
  if (result.flaggedSpans.length > 0) {
    console.log(colorize('\n🚩 FLAGGED TERMS:', 'red'));
    for (const span of result.flaggedSpans) {
      console.log(`   "${span.original}" → categories: ${span.categories.join(', ')}`);
    }
  }
  
  // Tier info (the key optimization insight!)
  const extResult = result as ExtendedModerationResult;
  if (extResult.tierInfo) {
    const ti = extResult.tierInfo;
    console.log(colorize('\n🏗️  DECISION TIER:', 'bright'));
    console.log(`   ${tierEmoji(ti.tier)} Tier: ${colorize(ti.tier.toUpperCase(), tierColor(ti.tier))}`);
    console.log(`   ${colorize('Reason:', 'dim')} ${ti.reason}`);
    if (ti.language && ti.language.script !== 'latin') {
      console.log(`   ${colorize('Script:', 'dim')} ${ti.language.script} (non-Latin → API required)`);
    }
    
    // Latency breakdown
    console.log(colorize('\n⏱️  LATENCY BREAKDOWN:', 'dim'));
    console.log(`   Local:   ${ti.localLatencyMs.toFixed(2)}ms`);
    if (ti.apiLatencyMs !== undefined) {
      console.log(`   API:     ${ti.apiLatencyMs.toFixed(2)}ms`);
    } else if (ti.skippedApi) {
      console.log(`   API:     ${colorize('SKIPPED (fast-path)', 'green')}`);
    }
    if (ti.councilLatencyMs !== undefined) {
      console.log(`   Council: ${ti.councilLatencyMs.toFixed(2)}ms`);
    } else if (ti.skippedCouncil) {
      console.log(`   Council: ${colorize('SKIPPED', 'dim')}`);
    }
    console.log(`   ${colorize('Total:', 'bright')} ${result.processingTimeMs.toFixed(2)}ms`);
  } else {
    console.log(colorize('\n⏱️  Processing time:', 'dim'), `${result.processingTimeMs.toFixed(2)}ms`);
  }
  
  // Provider info
  const providerInfo = moderator.getProviderInfo();
  console.log(colorize('\n🔌 PROVIDERS:', 'blue'));
  console.log(`   Primary: ${providerInfo.primary.displayName} (${providerInfo.primary.available ? 'available' : 'unavailable'})`);
  console.log(`   Fast-path: ${providerInfo.fastPathEnabled ? colorize('ENABLED', 'green') : colorize('DISABLED', 'yellow')}`);
  if (providerInfo.council.length > 0) {
    console.log(`   Council: ${providerInfo.council.join(', ')}`);
  }
  console.log('');
}

async function interactiveMode(moderator: Moderator) {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  console.log(colorize('\n🔬 CONTENT MODERATION TEST CLI', 'bright'));
  console.log(colorize('=' .repeat(40), 'dim'));
  console.log('Enter text to analyze (or "quit" to exit)\n');
  
  const prompt = () => {
    rl.question(colorize('> ', 'cyan'), async (input) => {
      if (input.toLowerCase() === 'quit' || input.toLowerCase() === 'exit') {
        console.log('Goodbye!');
        rl.close();
        return;
      }
      
      if (input.trim()) {
        await analyzeText(input, moderator);
      }
      prompt();
    });
  };
  
  prompt();
}

async function main() {
  const args = process.argv.slice(2);
  
  // Initialize moderator
  const apiKey = process.env.OPENAI_API_KEY;
  const moderator = new Moderator({
    openaiApiKey: apiKey,
    provider: apiKey ? 'openai' : 'local-only',
  });
  
  if (!apiKey) {
    console.log(colorize('\n⚠️  OPENAI_API_KEY not set - using local-only mode', 'yellow'));
    console.log(colorize('   Set OPENAI_API_KEY for full AI moderation\n', 'dim'));
  } else {
    console.log(colorize('\n✓ OpenAI API key detected - using full AI moderation\n', 'green'));
  }
  
  if (args.includes('--interactive') || args.includes('-i')) {
    await interactiveMode(moderator);
  } else if (args.length > 0 && !args[0].startsWith('-')) {
    // Direct text input
    const text = args.join(' ');
    await analyzeText(text, moderator);
  } else {
    // Show usage
    console.log(`
${colorize('CONTENT MODERATION TEST CLI', 'bright')}

${colorize('Usage:', 'cyan')}
  npx ts-node src/cli.ts "text to analyze"
  npx ts-node src/cli.ts --interactive
  npx ts-node src/cli.ts -i

${colorize('Examples:', 'cyan')}
  npx ts-node src/cli.ts "This is a test"
  npx ts-node src/cli.ts "You're such a f4gg0t"
  npx ts-node src/cli.ts "As a gay person, I reclaim the word queer"
  npx ts-node src/cli.ts "He called me a stupid n1gg3r yesterday"

${colorize('Environment:', 'cyan')}
  OPENAI_API_KEY - Set for full AI moderation (optional)
`);
  }
}

main().catch(console.error);

