# Content-Checker

A modern, tiered content moderation system with LLM council escalation for edge cases.

**Original Author:** Jacob Habib ([@jahabeebs](https://github.com/jahabeebs)), OpenModerator  
**Fork Enhancements:** Context-aware moderation, multi-provider support, LLM council, tiered fast-path optimization

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

For edge cases where primary model confidence is 30-70%:
- Multiple models vote (Claude, Gemini, etc.)
- Hybrid aggregation (unanimous = auto-decide, split = human review)
- Audit trail for compliance

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
npm install content-checker
```

## Quick Start

```typescript
import { Moderator } from 'content-checker';

const moderator = new Moderator({
  openaiApiKey: process.env.OPENAI_API_KEY,  // Optional, falls back to local
});

const result = await moderator.moderate("Your text here");

console.log(result.flagged);           // true/false
console.log(result.severity);          // 0.0 - 1.0
console.log(result.suggestedAction);   // 'allow' | 'warn' | 'review' | 'block'
console.log(result.tierInfo.tier);     // 'local' | 'api' | 'council' | 'human'
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
  severityThreshold: 0.3,   // >= this = flagged
  reviewThreshold: 0.7,     // >= this = review
  blockThreshold: 0.9,      // >= this = block
  
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
  flagged: boolean;                    // Should this be flagged?
  severity: number;                    // 0.0 - 1.0
  categories: CategoryScores;          // Per-category scores
  contextFactors: ContextFactors;      // Intent, target, reclamation, etc.
  suggestedAction: SuggestedAction;    // 'allow' | 'warn' | 'review' | 'block'
  confidence: number;                  // Model confidence
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
import { Filter } from 'content-checker';

const filter = new Filter();
filter.isProfane("some text");  // boolean
filter.clean("some text");      // censored string
```

---

## License

Apache 2.0 - See [LICENSE](LICENSE)

## Credits

- Original `content-checker` by [Jacob Habib](https://github.com/jahabeebs) / [OpenModerator](https://www.openmoderator.com)
- Fork enhancements: Context-aware moderation, tiered architecture, LLM council
