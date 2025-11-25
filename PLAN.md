# Content-Checker Enhancement Plan

## Overview

This document tracks the roadmap for improving the content-checker library with better detection, contextual understanding, and moderation workflows.

---

## Phase 1: Text Analysis ✅ Complete

### 1.1 Text Normalization Layer ✅
- **Homoglyph normalization** — Convert lookalike characters (Cyrillic а→a, Greek ο→o, etc.)
- **Leetspeak decoding** — Systematic conversion (1→i, 3→e, 0→o, @→a, $→s, etc.)
- **Zero-width character stripping** — Remove invisible Unicode chars used to break detection
- **Spacing normalization** — Handle "f u c k" and "f.u.c.k" patterns
- **Repeated char collapsing** — "fuuuuck" → "fuck"

### 1.2 Rich Result Types ✅
Categories:
- Hate Speech
- Harassment  
- Sexual Harassment
- Violence
- Drugs/Illegality
- Profanity
- Self-Harm/Suicide
- Threats
- Personal Information/Doxxing
- Child Safety (CSAM indicators)
- Spam/Scam

### 1.3 Context Evaluator ✅
- Intent detection (attacking vs. discussing vs. quoting vs. reclaiming)
- Target analysis (directed at person, group, self, abstract)
- Reclamation detection (in-group use of slurs)
- Educational/academic context flags
- Quote/reported speech detection
- Harm reduction calculation based on context

---

## Phase 2: Multi-Provider & LLM Council ✅ Complete

### 2.1 Provider Abstraction

Support multiple moderation backends with a unified interface:

```typescript
interface ModerationProvider {
  name: string;
  analyze(text: string): Promise<ProviderResult>;
  isAvailable(): boolean;
}

// Supported providers:
// - OpenAI Moderation API (free, fast)
// - Google Perspective API (free tier, multi-language)
// - Anthropic Claude (paid, nuanced reasoning)
// - Google Gemini (paid, balanced)
// - Llama Guard (self-hosted, open source)
// - Local-only (no API, just normalization + slur detection)
```

### 2.2 LLM Council Architecture

For edge cases where primary model confidence is low (30-70%), escalate to a council of multiple models for consensus.

**Why a council?**
- Reduces single-model bias
- Different models have different training data and cultural perspectives
- Catches cases where one model is confidently wrong
- Creates audit trail for human QA

**Council composition (configurable):**
- Claude (Anthropic) — Constitutional AI, tends toward caution
- Gemini (Google) — Balanced, corporate perspective
- Llama (Meta) — More permissive, open weights
- Mistral — European perspective, different cultural norms

### 2.3 Hybrid Decision Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    MODERATION DECISION FLOW                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Input Text                                                     │
│       ↓                                                         │
│  ┌─────────────────────────────────────┐                       │
│  │ 1. NORMALIZE                        │                       │
│  │    (homoglyphs, leetspeak, spacing) │                       │
│  └─────────────────┬───────────────────┘                       │
│                    ↓                                            │
│  ┌─────────────────────────────────────┐                       │
│  │ 2. PRIMARY CHECK                    │                       │
│  │    (fast: OpenAI Moderation API)    │                       │
│  └─────────────────┬───────────────────┘                       │
│                    ↓                                            │
│            ┌───────────────┐                                    │
│            │  Confidence?  │                                    │
│            └───────┬───────┘                                    │
│                    │                                            │
│     ┌──────────────┼──────────────┐                            │
│     ↓              ↓              ↓                            │
│   > 70%         30-70%         < 30%                           │
│  (HIGH)        (MEDIUM)        (LOW)                           │
│     │              │              │                            │
│     ↓              ↓              ↓                            │
│  Return        ESCALATE        Return                          │
│  result       to Council       result                          │
│                    │                                            │
│                    ↓                                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 3. LLM COUNCIL                                          │   │
│  │                                                         │   │
│  │   ┌─────────┐  ┌─────────┐  ┌─────────┐               │   │
│  │   │ Claude  │  │ Gemini  │  │  Llama  │  ...          │   │
│  │   └────┬────┘  └────┬────┘  └────┬────┘               │   │
│  │        │            │            │                     │   │
│  │        └────────────┼────────────┘                     │   │
│  │                     ↓                                  │   │
│  │              Anonymous Votes                           │   │
│  │         (each returns verdict + confidence)            │   │
│  └─────────────────────┬───────────────────────────────────┘   │
│                        ↓                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 4. HYBRID AGGREGATION                                   │   │
│  │                                                         │   │
│  │   Unanimous (3-0 or 0-3)?                              │   │
│  │        │                                                │   │
│  │   YES ─┴─→ Auto-decide (no judge needed)               │   │
│  │        │                                                │   │
│  │   NO ──┴─→ Majority (2-1)?                             │   │
│  │               │                                         │   │
│  │          YES ─┴─→ Avg confidence > 0.6?                │   │
│  │               │         │                               │   │
│  │               │    YES ─┴─→ Auto-decide (majority)     │   │
│  │               │         │                               │   │
│  │               │    NO ──┴─→ Human Queue                │   │
│  │               │                                         │   │
│  │          NO ──┴─→ Human Queue (true split)             │   │
│  │                                                         │   │
│  └─────────────────────┬───────────────────────────────────┘   │
│                        ↓                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 5. AUDIT LOG                                            │   │
│  │    - Original + normalized text                         │   │
│  │    - Primary model score                                │   │
│  │    - Council votes (if escalated)                       │   │
│  │    - Final decision + reasoning                         │   │
│  │    - Human override (if any)                            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.4 Escalation Thresholds (Configurable)

```typescript
interface EscalationConfig {
  // When to escalate to council
  escalateMin: number;        // Default: 0.30
  escalateMax: number;        // Default: 0.70
  
  // Council decision thresholds
  unanimousAutoDecide: boolean;           // Default: true
  majorityConfidenceThreshold: number;    // Default: 0.60
  
  // Human queue triggers
  sendSplitsToHuman: boolean;             // Default: true
  sendLowConfidenceToHuman: boolean;      // Default: true
}
```

### 2.5 Human Review Queue

Cases that go to human review:
- Council split votes (no majority)
- Majority with low average confidence
- Configurable severity thresholds
- Appeals from users

Queue interface:
```typescript
interface HumanReviewItem {
  id: string;
  text: string;
  normalized: string;
  primaryResult: ProviderResult;
  councilVotes?: CouncilVote[];
  reason: 'split' | 'low_confidence' | 'severity' | 'appeal';
  priority: number;
  createdAt: Date;
  status: 'pending' | 'reviewed' | 'decided';
  humanDecision?: ModerationDecision;
}
```

---

## Phase 2.5: Tiered Fast-Path Optimization ✅ Complete

### The Problem
API calls take ~800ms. For high-volume use cases, this latency and cost is prohibitive.

### The Solution
**Tiered architecture** that handles 80% of traffic locally in ~3ms:

```
TIER 1: LOCAL (~3ms)
├── Normalize text (homoglyphs, leetspeak)
├── Pattern match against severe slurs
├── Check clean text indicators
└── If confident (≥85% block OR ≤10% allow) → RETURN (skip API)

TIER 2: API (~800ms)
├── Call OpenAI Moderation API
├── Merge with local detection results
└── If confident (>70% or <30%) → RETURN (skip council)

TIER 3: COUNCIL (~2-3s)
├── Send to multiple LLMs (Claude, Gemini, etc.)
├── Aggregate votes
└── If unanimous or confident majority → RETURN

TIER 4: HUMAN QUEUE
└── Split votes or low confidence → queue for human review
```

### Configuration

```typescript
fastPath: {
  enabled: true,
  localBlockThreshold: 0.85,    // >= this → instant BLOCK, skip API
  localAllowThreshold: 0.10,    // <= this → instant ALLOW, skip API
  minLocalConfidence: 0.70,     // Must be this confident to fast-path
  alwaysCheckCategories: ['self_harm', 'child_safety', 'threats'],
}
```

### Results

| Input Type | Before | After | Speedup |
|------------|--------|-------|---------|
| Clean text | ~800ms | ~3ms | 266x |
| Obvious slurs | ~800ms | ~3ms | 266x |
| Subtle harassment | ~800ms | ~800ms | 1x |
| Edge cases | ~2000ms | ~2000ms | 1x |

**80% of traffic** (clean + obvious) now handled at **~3ms** instead of **~800ms**.

---

## Phase 3: Image Analysis (Shelved)

### 3.1 Multi-Category Image Classification
Expand beyond "Porn" and "Hentai" to include:
- Violence/Gore
- Hate symbols (swastikas, white supremacist imagery, etc.)
- Self-harm imagery
- Weapons
- Drug paraphernalia
- Graphic medical content
- Child safety indicators

### 3.2 Implementation Options
- **Local model**: CLIP-based classifier, fine-tuned on moderation dataset
- **API-based**: Azure Content Safety, AWS Rekognition, Google Cloud Vision Safety
- **Hybrid**: Fast local pre-filter + API for borderline cases

### 3.3 OCR Integration
- Extract text from images for text-based analysis
- Detect hate speech in memes, screenshots, etc.

---

## Phase 4: Action Dispatcher (Shelved)

### 4.1 Webhook Support
```typescript
interface WebhookConfig {
  url: string;
  events: ('flagged' | 'reviewed' | 'appealed')[];
  secret: string;
  retryPolicy: RetryPolicy;
}
```

### 4.2 Auto-Actions
```typescript
interface ActionPolicy {
  condition: ModerationCondition;
  action: 'allow' | 'warn' | 'shadowban' | 'remove' | 'suspend';
  notify: boolean;
  escalate: boolean;
}
```

### 4.3 Appeals Workflow
- User-initiated appeal submission
- Re-review triggers
- Outcome tracking

---

## Technical Decisions

### Provider Strategy
- **Primary**: OpenAI Moderation API (free, fast, good baseline)
- **Council**: Claude + Gemini + Llama (diverse perspectives)
- **Fallback**: Google Perspective API (if OpenAI unavailable)
- **Local**: Normalization + severe slur detection always runs locally

### Why Keep Normalization Even with LLM?
LLMs tokenize text into subwords. Heavy obfuscation like `n1gg3r` or `ⓕⓤⓒⓚ` produces garbage tokens that the model can't interpret. Normalization "decodes" obfuscation before the LLM sees it, dramatically improving detection.

### Hardcoded Lists
Moving away from hardcoded bad word lists in favor of:
1. Normalization → LLM pipeline for detection
2. Small curated list only for extreme slurs that need 100% catch rate
3. Context evaluation to reduce false positives

### Why No Dedicated Judge Model?
- Unanimous council = high signal, no judge needed
- Majority + high confidence = good enough
- True edge cases → human review (builds training data)
- Avoids extra API cost and single point of failure

---

## Configuration

```typescript
interface ContentModeratorConfig {
  // Provider selection
  primaryProvider: 'openai' | 'perspective' | 'local';
  
  // Council configuration
  council: {
    enabled: boolean;
    members: ('claude' | 'gemini' | 'llama' | 'mistral')[];
    escalateMin: number;  // 0.30
    escalateMax: number;  // 0.70
  };
  
  // Human review
  humanReview: {
    enabled: boolean;
    webhookUrl?: string;
    sendSplits: boolean;
    sendLowConfidence: boolean;
  };
  
  // API Keys (from env or config)
  apiKeys: {
    openai?: string;
    anthropic?: string;
    google?: string;
    // etc.
  };
}
```

---

## Open Questions

- [x] Should we support multiple LLM providers? **Yes, via provider abstraction**
- [x] How to handle edge cases? **LLM Council + Human queue**
- [ ] Rate limiting strategy for API calls?
- [ ] Caching strategy for repeated content?
- [ ] Multi-language support priority?
- [ ] How to train custom judge model from human QA data?

---

## References

- [OpenAI Moderation API](https://platform.openai.com/docs/guides/moderation)
- [Google Perspective API](https://perspectiveapi.com/)
- [Anthropic Claude](https://docs.anthropic.com/)
- [Llama Guard](https://ai.meta.com/research/publications/llama-guard-llm-based-input-output-safeguard-for-human-ai-conversations/)
- [Unicode Confusables](https://unicode.org/reports/tr39/#Confusable_Detection)
