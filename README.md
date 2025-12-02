# council-mod

**User-first content moderation for communities that actually care about safety.**

Tiered LLM content moderation with council consensus for edge cases. Built for platforms where user safety matters more than retention metrics.

**Based on:** [content-checker](https://github.com/jahabeebs/content-checker) by Jacob Habib ([@jahabeebs](https://github.com/jahabeebs))  
**Enhancements:** Context-aware moderation, multi-provider support, LLM council, tiered fast-path, multilingual support

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

---

## 🎯 Built for User Safety

**council-mod** is designed for communities that prioritize **user safety and well-being** over engagement metrics. We believe moderation should protect people, not just platforms.

**Traditional approach:** "I know where you live" → harassment → warning  
**Our approach:** "I know where you live" → threat → immediate action

### Who This Is For

**Ideal for:**
- **LGBTQ+ communities and safe spaces** — Context-aware reclamation vs. attack detection
- **Platforms for marginalized groups** — Recognizes dog whistles and coded language
- **Community-run platforms** — Transparent, configurable, no black boxes
- **Gaming communities** — Nuanced detection beyond simple slur filtering
- **Mental health & support communities** — Sensitive to vulnerable populations
- **Anyone building safer spaces** — Tools for communities that care

**Also works for:**
- Traditional platforms wanting better moderation
- Enterprise applications with duty of care
- Educational institutions
- Healthcare and therapy platforms

### The Philosophy

**Implied threats are threats.** 

"I know where you live. Nice house you've got there" is often MORE concerning than explicit threats because it demonstrates real surveillance and calculated behavior. From a user's perspective, these feel equally dangerous. Our classification reflects that lived experience.

**We prioritize user safety over industry conventions** when they diverge. You can always remap our categories for compliance reporting while keeping the safety-first severity scoring.

---

## Features

### 🚀 Tiered Fast-Path Architecture

```
Input → TIER 1: Local (~3ms)     → Obvious cases handled instantly
            ↓
        TIER 2: API (~800ms)     → Nuanced detection for uncertain cases
            ↓
        TIER 3: Council (~2-3s)  → Multi-model consensus for edge cases
            ↓
        TIER 4: Human Queue      → True edge cases flagged for review
```

- **80% of traffic handled in ~3ms** (clean text + obvious slurs)
- **API only called for uncertain cases**
- **Council escalation** for mid-confidence results (30-70%)

### 🛡️ Advanced Detection

- **Text Normalization** — Catches obfuscation (leetspeak, homoglyphs, zero-width chars)
  - `f4gg0t` → `faggot`
  - `n1gg3r` → `nigger`
  - Cyrillic/Greek lookalikes → ASCII
- **Context Evaluation** — Understands intent, not just keywords
  - Reclamation ("As a gay man, I reclaim...")
  - Educational ("The word X was historically...")
  - Quoted speech ("He called me a...")

### 🏛️ LLM Council

For edge cases that need escalation:
- Multiple models vote (Claude, Gemini, etc.)
- Hybrid aggregation (unanimous = auto-decide, split = human review)
- Audit trail for compliance

### 🎯 Simple Decision Model

Only three outcomes:

| Action | When | Meaning |
|--------|------|---------|
| **ALLOW** | Severity < 30% AND confident | Content is acceptable |
| **DENY** | Severity ≥ 70% AND confident | Content should be blocked |
| **ESCALATE** | Middle severity OR not confident | Needs higher-tier review |

Escalation chain: `Local → API → Council → Human`

### 🌍 Multilingual Support

Non-Latin scripts (CJK, Cyrillic, Arabic, etc.) automatically skip fast-path and go to API:

```
Latin text → Fast-path eligible (local detection works)
Chinese 你好 → Skip fast-path → API (our patterns don't cover CJK)
Russian Привет → Skip fast-path → API
```

Supported scripts: Latin, CJK, Cyrillic, Arabic, Hebrew, Thai, Devanagari, Greek

### 📊 Categories

| Category | Description |
|----------|-------------|
| `hate_speech` | Attacks based on protected characteristics |
| `harassment` | Bullying, intimidation |
| `sexual_harassment` | Unwanted sexual content |
| `violence` | Graphic violence, gore |
| `threats` | Direct threats to harm |
| `self_harm` | Content promoting self-harm/suicide |
| `drugs_illegal` | Illegal drug promotion |
| `profanity` | Strong profane language |
| `child_safety` | Content endangering minors |
| `personal_info` | Doxxing, private info |
| `spam_scam` | Spam, scams, phishing |

---

## Installation

```bash
npm install council-mod
```

## Quick Start

```typescript
import { Moderator } from 'council-mod';

const moderator = new Moderator({
  openaiApiKey: process.env.OPENAI_API_KEY,  // Optional, falls back to local
});

const result = await moderator.moderate("Your text here");

console.log(result.action);            // 'allow' | 'deny' | 'escalate'
console.log(result.flagged);           // true (if action === 'deny')
console.log(result.severity);          // 0.0 - 1.0
console.log(result.confidence);        // 0.0 - 1.0
console.log(result.tierInfo.tier);     // 'local' | 'api' | 'council' | 'human'
```

## Usage Examples

### Basic Moderation

```typescript
import { Moderator } from 'council-mod';

const mod = new Moderator({
  openaiApiKey: process.env.OPENAI_API_KEY,
});

// Simple check
const result = await mod.moderate("This is fine");
console.log(result.action);  // 'allow'

// Handles obfuscation
const result2 = await mod.moderate("f4gg0t");
console.log(result2.flagged);  // true
console.log(result2.normalized);  // 'faggot'

// Understands context
const result3 = await mod.moderate(
  "The word 'faggot' has been historically used as a slur"
);
console.log(result3.action);  // 'allow' (educational context)
```

### With Context

```typescript
// Ambiguous short text
const result = await mod.moderate("にがー");  // Could be "bitter" or slur
console.log(result.action);  // 'escalate' (needs context)

// With conversation context
const result2 = await mod.moderate("にがー", {
  context: ["コーヒー飲んだ", "めっちゃ濃かった"]
});
console.log(result2.action);  // 'allow' (clearly means "bitter coffee")
```

### Fast Local Check

```typescript
// Skip API, local-only (~3ms)
const quick = await mod.quickCheck("hello world");
console.log(quick.flagged);  // false
console.log(quick.latencyMs);  // ~3
```

### Council Escalation

```typescript
const mod = new Moderator({
  openaiApiKey: process.env.OPENAI_API_KEY,
  council: {
    enabled: true,
    members: ['anthropic', 'gemini'],
  },
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  googleApiKey: process.env.GOOGLE_API_KEY,
});

// Ambiguous case triggers council
const result = await mod.moderate("borderline content");
console.log(result.tierInfo.tier);  // 'council'
console.log(result.action);  // Multiple models voted
```

## CLI Testing

```bash
# Set API key (optional)
export OPENAI_API_KEY="sk-..."

# Test a phrase
npx tsx src/cli.ts "Your text here"

# Interactive mode
npx tsx src/cli.ts --interactive
```

---

## Development

### Setup

```bash
# Clone and install
git clone <repo-url>
cd content-checker/content-checker
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your API keys
```

### Environment Variables

Create a `.env` file:

```bash
# Required for API moderation
OPENAI_API_KEY=sk-...

# Optional: For council voting
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...

# Optional: Alternative provider
PERSPECTIVE_API_KEY=...
```

### Build

```bash
npm run build      # Build library
npm run test       # Run unit tests
```

### QA Testing

Generate test cases and run audits:

```bash
# 1. Generate test cases (uses Claude Opus 4.5)
npm run generate:tests

# 2. Run LLM audits
npm run audit:llm      # Gemini 3 Pro
npm run audit:claude   # Claude Sonnet 4.5

# 3. Human audit (interactive CLI)
npm run audit

# 4. Calculate agreement metrics
npm run agreement

# 5. View dashboard
npm run dashboard
```

### QA Audit CLI

Interactive terminal interface for human auditing:

```
CONTENT MODERATION AUDIT CLI
Progress: 45/550 (8.2%)
Current:  #46

TEXT:
┌──────────────────────────────────────────────────────┐
│ This is the content to moderate...                  │
└──────────────────────────────────────────────────────┘

CONTEXT (previous messages):
  [1] Previous message if any
  [2] More context

[A] Allow    [D] Deny     [E] Escalate
[S] Skip     [B] Back     [Q] Quit & Save

Your decision: _
```

**Features:**
- Auto-saves progress after each decision
- Resume from where you left off
- Randomized case order (prevents bias)
- Blind audit (no category hints)
- Statistics: `npm run audit -- --stats`

---

## Configuration

### Council Provider Recommendations

**Default council members:** `['anthropic', 'gemini']`

Based on QA testing (600 test cases, human + LLM auditors, Gwet's AC1):

| Provider | Agreement with Human | Pros | Cons | Cost (per 1K) |
|----------|---------------------|------|------|---------------|
| **Claude Sonnet 4.5** | High (TBD) | Fast, nuanced, good with context | Higher cost | ~$3.00 |
| **Gemini 3 Pro** | Medium (TBD) | Lower cost, good multilingual | Quota limits (Tier 1: 250 RPD) | ~$1.25 |
| **OpenAI GPT-4** | TBD | Widely tested, reliable | Higher cost | ~$2.50 |
| **OpenAI GPT-4o-mini** | TBD | Very cheap, fast | Less nuanced | ~$0.15 |

**Recommended configurations:**

```typescript
// High accuracy (expensive)
council: {
  members: ['anthropic', 'gemini'],  // Best agreement with human
}

// Balanced (recommended)
council: {
  members: ['anthropic', 'openai'],  // Good accuracy, no quota issues
}

// Budget (cheaper)
council: {
  members: ['gemini', 'openai-mini'],  // Lower cost, still decent
}

// High volume (fast)
council: {
  members: ['openai-mini', 'gemini'],  // Faster responses
}
```

**Known issues:**
- **Gemini Tier 1:** Only 250 requests/day (upgrade to Tier 2 for production)
- **Claude:** Can be slower during peak times
- **Category precision:** LLMs sometimes conflate `violence` with `threats` (see QA_ROUNDS.md)

**Agreement patterns (from QA):**
- High agreement on clear violations (hate speech, explicit threats)
- More disagreement on edge cases (confessions, ideation, context-dependent)
- LLMs tend to be more conservative than human auditors

For detailed QA methodology and findings, see `QA_ROUNDS.md`.

---

### Full Configuration

```typescript
const moderator = new Moderator({
  // Provider selection
  provider: 'openai',  // 'openai' | 'perspective' | 'local-only'
  openaiApiKey: process.env.OPENAI_API_KEY,
  
  // Fast-path optimization
  fastPath: {
    enabled: true,
    localBlockThreshold: 0.85,    // Skip API, instant block
    localAllowThreshold: 0.10,    // Skip API, instant allow
    minLocalConfidence: 0.70,     // Required confidence for fast-path
    alwaysCheckCategories: ['self_harm', 'child_safety', 'threats'],
  },
  
  // Council configuration
  council: {
    enabled: true,
    members: ['anthropic', 'gemini'],  // Council voters
    escalateMin: 0.30,                  // Escalate if confidence >= 30%
    escalateMax: 0.70,                  // Escalate if confidence <= 70%
    sendSplitsToHuman: true,            // Split votes → human queue
    sendLowConfidenceToHuman: true,     // Low confidence majority → human queue
  },
  
  // Thresholds
  allowThreshold: 0.3,        // Severity < 30% = ALLOW
  denyThreshold: 0.7,         // Severity >= 70% = DENY
  confidenceThreshold: 0.7,   // Confidence < 70% = ESCALATE
  
  // Behavior
  normalizeText: true,      // Apply obfuscation detection
  analyzeContext: true,     // Evaluate intent/reclamation
});
```

### Environment Variables

```bash
OPENAI_API_KEY=sk-...           # OpenAI Moderation API (free)
ANTHROPIC_API_KEY=sk-ant-...    # Claude (council member)
GOOGLE_API_KEY=...              # Gemini (council member)
PERSPECTIVE_API_KEY=...         # Google Perspective API
```

---

## 💰 Cost Optimization

### Prompt Caching

council-mod uses prompt caching to reduce API costs by **85-90%** for high-volume use. The moderation guidelines (~850 tokens) are cached and reused across requests.

**Without caching:**
- 1,000 moderations × 950 tokens = 950K tokens ≈ $28

**With caching (enabled by default):**
- First call: 950 tokens
- Remaining 999 calls: ~100 tokens each = 100K tokens ≈ $3
- **Savings: ~$25 (89%)**

### Provider Support

| Provider | Caching Method | Savings | Notes |
|----------|---------------|---------|-------|
| **Claude** | Explicit `cache_control` | ~90% | Uses `anthropic-beta` header |
| **Gemini** | `systemInstruction` | ~80% | Server-side caching |
| **GPT-5.1** | Automatic | ~50% | Cached tokens at half price |
| **OpenAI Moderation** | N/A | Free | No caching needed |

### Configuration

```typescript
// Caching is enabled by default
const moderator = new Moderator({
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  googleApiKey: process.env.GOOGLE_API_KEY,
});

// Disable caching if needed (not recommended)
const provider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
  enableCaching: false,  // Default: true
});
```

### Cache Statistics

```typescript
// Get provider cache stats (for cost tracking)
const anthropicProvider = new AnthropicProvider({ apiKey: '...' });
// ... after some requests ...
console.log(anthropicProvider.getCacheStats());
// {
//   totalRequests: 100,
//   cacheHits: 99,
//   cacheCreations: 1,
//   inputTokens: 10000,
//   cachedTokens: 84150,
//   savingsPercent: '89.4'
// }
```

### Best Practices

1. **High volume:** Caching is most effective with sustained traffic (100+ req/hour)
2. **Batch processing:** Process items in sequence, not parallel, for cache hits
3. **Session grouping:** Group requests within 5-minute windows (cache TTL)
4. **Local first:** Use `quickCheck()` for obvious cases to skip API entirely

---

## API Reference

### `moderate(text: string): Promise<ExtendedModerationResult>`

Main moderation method.

```typescript
interface ExtendedModerationResult {
  action: FinalAction;                 // 'allow' | 'deny' | 'escalate'
  flagged: boolean;                    // true if action === 'deny'
  severity: number;                    // 0.0 - 1.0
  confidence: number;                  // Model confidence
  categories: CategoryScores;          // Per-category scores
  contextFactors: ContextFactors;      // Intent, target, reclamation, etc.
  flaggedSpans: FlaggedSpan[];         // Specific flagged terms
  normalized: string;                  // Text after normalization
  original: string;                    // Original input
  processingTimeMs: number;            // Latency
  tierInfo: TierInfo;                  // Which tier handled this
}

interface TierInfo {
  tier: 'local' | 'api' | 'council' | 'human';
  reason: string;
  localLatencyMs: number;
  apiLatencyMs?: number;
  councilLatencyMs?: number;
  skippedApi: boolean;
  skippedCouncil: boolean;
}
```

### `quickCheck(text: string): Promise<{ flagged, severity, latencyMs }>`

Fast local-only check (~3ms). No API calls.

### `getHumanReviewQueue(): HumanReviewItem[]`

Get items queued for human review.

### `submitHumanDecision(itemId, decision): boolean`

Submit a human decision for a queued item.

### `getAuditLog(limit?): AuditLogEntry[]`

Get audit log entries for compliance.

### `getStats()`

Get statistics on decisions, escalations, etc.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    MODERATION PIPELINE                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Input Text                                                     │
│       ↓                                                         │
│  ┌─────────────────────────────────────┐                       │
│  │ NORMALIZER                          │                       │
│  │ • Homoglyphs (Cyrillic→Latin)       │                       │
│  │ • Leetspeak (1→i, 3→e, 0→o)         │                       │
│  │ • Zero-width char removal           │                       │
│  │ • Spacing collapse (f.u.c.k→fuck)   │                       │
│  └─────────────────┬───────────────────┘                       │
│                    ↓                                            │
│  ┌─────────────────────────────────────┐                       │
│  │ TIER 1: LOCAL FAST-PATH (~3ms)      │                       │
│  │ • Pattern matching                   │                       │
│  │ • Severe slur detection             │                       │
│  │ • Clean text indicators             │                       │
│  └─────────────────┬───────────────────┘                       │
│                    ↓                                            │
│         ┌──────────┴──────────┐                                │
│         │ Can fast-path?      │                                │
│         └──────────┬──────────┘                                │
│                    │                                            │
│      YES ←─────────┴─────────→ NO                              │
│       │                         │                              │
│       ↓                         ↓                              │
│  Return result         ┌────────────────────┐                  │
│  (skip API)            │ TIER 2: API CHECK  │                  │
│                        │ (~800ms)           │                  │
│                        └─────────┬──────────┘                  │
│                                  ↓                              │
│                       ┌──────────┴──────────┐                  │
│                       │ Confidence 30-70%?  │                  │
│                       └──────────┬──────────┘                  │
│                                  │                              │
│                    YES ←─────────┴─────────→ NO                │
│                     │                         │                │
│                     ↓                         ↓                │
│           ┌──────────────────┐         Return result          │
│           │ TIER 3: COUNCIL  │                                │
│           │ (~2-3s)          │                                │
│           │                  │                                │
│           │ Claude + Gemini  │                                │
│           │ vote + aggregate │                                │
│           └─────────┬────────┘                                │
│                     ↓                                          │
│           ┌──────────────────┐                                │
│           │ Unanimous?       │                                │
│           │ Majority + conf? │                                │
│           └─────────┬────────┘                                │
│                     │                                          │
│      AUTO ←─────────┴─────────→ SPLIT                         │
│       │                         │                              │
│       ↓                         ↓                              │
│  Return result         ┌──────────────────┐                   │
│                        │ TIER 4: HUMAN    │                   │
│                        │ REVIEW QUEUE     │                   │
│                        └──────────────────┘                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Context Evaluation

The system understands that context matters:

| Context | Example | Harm Reduction |
|---------|---------|----------------|
| **Attack** | "You're a [slur]" | None (full severity) |
| **Discussion** | "The word [slur] is offensive" | Moderate |
| **Quote** | "He called me a [slur]" | Moderate |
| **Educational** | "Historically, [slur] was used to..." | Significant |
| **Reclamation** | "As a [identity], I reclaim [slur]" | Maximum |

---

## Documentation

- **[PLAN.md](./PLAN.md)** - Development roadmap and architecture decisions
- **[CATEGORY_DEFINITIONS.md](./CATEGORY_DEFINITIONS.md)** - Formal definitions for all 11 moderation categories
- **[EXPERIMENTS.md](./EXPERIMENTS.md)** - Test results and edge cases

## Files

```
src/
├── moderator.ts      # Main orchestrator with tiered fast-path
├── normalizer.ts     # Text normalization (homoglyphs, leetspeak)
├── context.ts        # Context evaluation (intent, reclamation)
├── language.ts       # Script detection (Latin, CJK, Cyrillic, etc.)
├── council.ts        # LLM council with hybrid aggregation
├── providers/
│   ├── openai.ts     # OpenAI Moderation API (free)
│   ├── anthropic.ts  # Claude (council)
│   ├── google.ts     # Perspective + Gemini
│   ├── local.ts      # Pattern-based local detection
│   └── types.ts      # Provider interfaces
├── types.ts          # Core types and config
├── cli.ts            # Test CLI
└── index.ts          # Exports
```

---

## Legacy API

The original `Filter` class is still available for backwards compatibility:

```typescript
import { Filter } from 'council-mod';

const filter = new Filter();
filter.isProfane("some text");  // boolean
filter.clean("some text");      // censored string
```

---

---

## Production Deployment

### Error Handling

Always wrap moderation calls in try-catch:

```typescript
import { Moderator } from 'council-mod';

const moderator = new Moderator({
  openaiApiKey: process.env.OPENAI_API_KEY,
  // Fallback to local if API unavailable
  provider: 'openai',
});

async function moderateContent(text: string) {
  try {
    const result = await moderator.moderate(text);
    return result;
  } catch (error) {
    console.error('Moderation error:', error);
    
    // Fallback: Use local-only check
    try {
      const localResult = await moderator.quickCheck(text);
      return {
        action: localResult.flagged ? 'deny' : 'allow',
        flagged: localResult.flagged,
        severity: localResult.severity,
        confidence: 0.5,  // Lower confidence for fallback
        tierInfo: { tier: 'local', reason: 'API unavailable' },
      };
    } catch (fallbackError) {
      // Ultimate fallback: allow but log for review
      console.error('Local fallback failed:', fallbackError);
      return {
        action: 'escalate',
        flagged: false,
        severity: 0,
        confidence: 0,
        tierInfo: { tier: 'human', reason: 'system error' },
      };
    }
  }
}
```

### Rate Limiting

Handle API rate limits gracefully:

```typescript
class RateLimitedModerator {
  private moderator: Moderator;
  private queue: Array<{ text: string; resolve: Function }> = [];
  private processing = false;
  private requestsPerMinute = 50;  // Adjust based on your tier
  
  constructor(config) {
    this.moderator = new Moderator(config);
  }
  
  async moderate(text: string): Promise<ExtendedModerationResult> {
    return new Promise((resolve) => {
      this.queue.push({ text, resolve });
      this.processQueue();
    });
  }
  
  private async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    const delay = 60000 / this.requestsPerMinute; // ms between requests
    
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      const result = await this.moderator.moderate(item.text);
      item.resolve(result);
      
      if (this.queue.length > 0) {
        await new Promise(r => setTimeout(r, delay));
      }
    }
    
    this.processing = false;
  }
}
```

### Integration Patterns

#### Express Middleware

```typescript
import { Moderator } from 'council-mod';
import express from 'express';

const moderator = new Moderator({
  openaiApiKey: process.env.OPENAI_API_KEY,
  denyThreshold: 0.7,
});

// Middleware to moderate request content
const moderateContent = (field: string) => {
  return async (req, res, next) => {
    const text = req.body[field];
    
    if (!text) return next();
    
    try {
      const result = await moderator.moderate(text, {
        userId: req.user?.id,
        platform: 'web',
      });
      
      if (result.action === 'deny') {
        return res.status(400).json({
          error: 'Content violates community guidelines',
          details: {
            severity: result.severity,
            categories: Object.keys(result.categories)
              .filter(k => result.categories[k] > 0.5),
          },
        });
      }
      
      if (result.action === 'escalate') {
        // Log for human review but allow through
        console.log('Escalated for review:', {
          userId: req.user?.id,
          text: result.flaggedSpans,
        });
      }
      
      // Attach moderation result to request
      req.moderationResult = result;
      next();
    } catch (error) {
      console.error('Moderation error:', error);
      // Fail open or closed based on your needs
      next();  // Fail open: allow on error
      // res.status(503).json({ error: 'Moderation unavailable' });  // Fail closed
    }
  };
};

app.post('/api/comments', moderateContent('text'), (req, res) => {
  // Comment is pre-moderated
  // Save to database...
  res.json({ success: true });
});
```

#### Discord Bot

```typescript
import { Client, Message } from 'discord.js';
import { Moderator } from 'council-mod';

const moderator = new Moderator({
  openaiApiKey: process.env.OPENAI_API_KEY,
});

const client = new Client({ intents: ['GUILDS', 'GUILD_MESSAGES'] });

client.on('messageCreate', async (message: Message) => {
  if (message.author.bot) return;
  
  const result = await moderator.moderate(message.content, {
    userId: message.author.id,
    platform: 'discord',
  });
  
  if (result.action === 'deny') {
    await message.delete();
    await message.author.send(
      `Your message was removed for violating guidelines (severity: ${(result.severity * 100).toFixed(0)}%)`
    );
    
    // Log to mod channel
    const modChannel = message.guild?.channels.cache.find(
      c => c.name === 'mod-log'
    );
    await modChannel?.send({
      embeds: [{
        title: 'Message Removed',
        fields: [
          { name: 'User', value: message.author.tag },
          { name: 'Channel', value: message.channel.toString() },
          { name: 'Content', value: message.content },
          { name: 'Severity', value: `${(result.severity * 100).toFixed(0)}%` },
          { name: 'Categories', value: Object.keys(result.categories).join(', ') },
        ],
      }],
    });
  }
});
```

#### Batch Processing

```typescript
async function moderateBatch(texts: string[]): Promise<ExtendedModerationResult[]> {
  const moderator = new Moderator({
    openaiApiKey: process.env.OPENAI_API_KEY,
  });
  
  const results: ExtendedModerationResult[] = [];
  const batchSize = 10;  // Process in chunks
  
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    
    // Process batch in parallel
    const batchResults = await Promise.all(
      batch.map(text => moderator.moderate(text))
    );
    
    results.push(...batchResults);
    
    // Progress update
    console.log(`Processed ${Math.min(i + batchSize, texts.length)}/${texts.length}`);
    
    // Rate limiting pause between batches
    if (i + batchSize < texts.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  return results;
}

// Usage: Scan existing content
const comments = await db.comments.findMany({ moderated: false });
const results = await moderateBatch(comments.map(c => c.text));

for (let i = 0; i < results.length; i++) {
  if (results[i].action === 'deny') {
    await db.comments.update({
      where: { id: comments[i].id },
      data: { hidden: true, moderationReason: 'flagged' },
    });
  }
}
```

### Configuration Best Practices

```typescript
// Development: More verbose, log everything
const devModerator = new Moderator({
  provider: 'local-only',  // Free, no API calls
  denyThreshold: 0.8,  // More lenient
  normalizeText: true,
  analyzeContext: true,
});

// Production: Balanced settings
const prodModerator = new Moderator({
  provider: 'openai',
  openaiApiKey: process.env.OPENAI_API_KEY,
  denyThreshold: 0.7,
  confidenceThreshold: 0.7,
  fastPath: {
    enabled: true,
    localBlockThreshold: 0.85,
    localAllowThreshold: 0.10,
  },
  council: {
    enabled: true,
    members: ['anthropic', 'gemini'],
    escalateMin: 0.30,
    escalateMax: 0.70,
  },
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  googleApiKey: process.env.GOOGLE_API_KEY,
});

// Strict: For high-risk content (kids platform, etc.)
const strictModerator = new Moderator({
  provider: 'openai',
  openaiApiKey: process.env.OPENAI_API_KEY,
  denyThreshold: 0.5,  // Lower threshold = more blocks
  confidenceThreshold: 0.8,  // Higher confidence required
  fastPath: {
    enabled: true,
    alwaysCheckCategories: [
      'child_safety',
      'self_harm',
      'threats',
      'violence',
    ],
  },
});
```

### Monitoring & Metrics

```typescript
class MonitoredModerator extends Moderator {
  private stats = {
    total: 0,
    allowed: 0,
    denied: 0,
    escalated: 0,
    averageLatency: 0,
    tierUsage: {
      local: 0,
      api: 0,
      council: 0,
    },
  };
  
  async moderate(text: string, options?) {
    const start = Date.now();
    const result = await super.moderate(text, options);
    const latency = Date.now() - start;
    
    // Update stats
    this.stats.total++;
    this.stats[result.action]++;
    this.stats.tierUsage[result.tierInfo.tier]++;
    
    // Rolling average
    this.stats.averageLatency = 
      (this.stats.averageLatency * (this.stats.total - 1) + latency) / 
      this.stats.total;
    
    // Log high-severity cases
    if (result.severity > 0.9) {
      console.warn('High severity content:', {
        text: result.original,
        severity: result.severity,
        categories: result.categories,
      });
    }
    
    return result;
  }
  
  getStats() {
    return {
      ...this.stats,
      fastPathEfficiency: 
        (this.stats.tierUsage.local / this.stats.total) * 100,
    };
  }
}

// Periodic reporting
setInterval(() => {
  const stats = moderator.getStats();
  console.log('Moderation Stats:', stats);
  // Send to monitoring service (DataDog, CloudWatch, etc.)
}, 60000);
```

---

## Troubleshooting

### "API key not working"

```typescript
// Test API connection
import { Moderator } from 'council-mod';

const moderator = new Moderator({
  openaiApiKey: process.env.OPENAI_API_KEY,
});

try {
  const result = await moderator.moderate("test");
  console.log('API working:', result.tierInfo.tier);
} catch (error) {
  console.error('API error:', error.message);
  // Check: Is OPENAI_API_KEY set? Is it valid? Do you have credits?
}
```

### "Slow performance"

```typescript
// Check which tier is being used
const result = await moderator.moderate("text");
console.log('Tier:', result.tierInfo.tier);
console.log('Latency:', result.processingTimeMs);

// If always hitting API/council:
// - Enable fast-path
// - Adjust thresholds
// - Use quickCheck() for high-volume scenarios
```

### "Too many false positives"

```typescript
// Adjust thresholds
const moderator = new Moderator({
  openaiApiKey: process.env.OPENAI_API_KEY,
  denyThreshold: 0.8,  // Increase (was 0.7)
  confidenceThreshold: 0.6,  // Decrease (was 0.7)
  // More content will escalate instead of deny
});
```

### "Missing context awareness"

```typescript
// Always provide context when available
const result = await moderator.moderate(newMessage, {
  context: previousMessages.map(m => m.text),
  userId: user.id,
  platform: 'chat',
});

// Context helps disambiguate:
// - Reclaimed language
// - Quoted speech
// - Educational discussion
// - Cultural differences
```

---

## License

Apache 2.0 - See [LICENSE](LICENSE)

## Credits

- Original `content-checker` by [Jacob Habib](https://github.com/jahabeebs) / [OpenModerator](https://www.openmoderator.com)
- `council-mod` enhancements by [GTLocalize](https://github.com/gtlocalize)
