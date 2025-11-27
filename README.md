# council-mod

Tiered LLM content moderation with council consensus for edge cases.

**Based on:** [content-checker](https://github.com/jahabeebs/content-checker) by Jacob Habib ([@jahabeebs](https://github.com/jahabeebs))  
**Enhancements:** Context-aware moderation, multi-provider support, LLM council, tiered fast-path, multilingual support

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

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

## License

Apache 2.0 - See [LICENSE](LICENSE)

## Credits

- Original `content-checker` by [Jacob Habib](https://github.com/jahabeebs) / [OpenModerator](https://www.openmoderator.com)
- `council-mod` enhancements by [GTLocalize](https://github.com/gtlocalize)
