# council-mod Development Plan

## Decision Model

**Three final outcomes only:**

| Action | Meaning | When |
|--------|---------|------|
| **ALLOW** | Content is acceptable | Severity < 30% AND confidence ≥ 70% |
| **DENY** | Content should be blocked | Severity ≥ 70% AND confidence ≥ 70% |
| **ESCALATE** | Needs higher-tier review | Severity 30-70% OR confidence < 70% |

**Escalation Chain:**
```
Local → not confident? → Escalate to API
API → not confident? → Escalate to Council
Council → split/uncertain? → Escalate to Human
Human → FINAL (Allow or Deny)
```

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

## Phase 3: Multi-Language Support (In Progress)

### 3.1 Current State ✅
- **Language/script detection** — Detects Latin, CJK, Cyrillic, Arabic, Hebrew, Thai, Devanagari, Greek
- **Non-Latin routing** — Non-Latin scripts skip fast-path, go directly to API
- **Basic coverage** — OpenAI's API handles many languages (with varying quality)

### 3.2 Known Limitations
- **OpenAI's multilingual gaps** — Chinese hate speech scored only 56% in testing
- **No local slur detection** — Fast-path only works for Latin scripts
- **Context patterns** — English-only regex for reclamation/educational detection

### 3.3 Future Improvements (Roadmap)

#### Short-term
- [ ] Add Perspective API as fallback (better multilingual support)
- [ ] Ensemble approach: max(OpenAI, Perspective) for non-English
- [ ] Language-specific severity thresholds

#### Medium-term
- [ ] Multilingual slur database (HurtLex integration or custom)
- [ ] CJK homophone normalization (傻逼 vs 煞笔 vs SB)
- [ ] Language-specific context patterns

#### Long-term
- [ ] Fine-tuned multilingual classifier
- [ ] Use LLM for context detection (not regex)
- [ ] Per-language severity calibration based on QA data

### 3.4 Supported Scripts

| Script | Detection | Fast-Path | API | Notes |
|--------|-----------|-----------|-----|-------|
| Latin | ✅ | ✅ | ✅ | Full support |
| CJK (Chinese/Japanese/Korean) | ✅ | ❌ Skip | ✅ | API-only, quality varies |
| Cyrillic | ✅ | ❌ Skip | ✅ | API-only |
| Arabic | ✅ | ❌ Skip | ✅ | API-only |
| Hebrew | ✅ | ❌ Skip | ✅ | API-only |
| Thai | ✅ | ❌ Skip | ✅ | API-only |
| Devanagari | ✅ | ❌ Skip | ✅ | API-only |
| Greek | ✅ | ❌ Skip | ✅ | API-only |
| Mixed | ✅ | ❌ Skip | ✅ | API-only |

---

## Phase 8: Image Analysis (Shelved)

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

## Phase 9: Action Dispatcher (Shelved)

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
- [x] Multi-language support? **Script detection + API routing (Phase 3)**
- [ ] Rate limiting strategy for API calls?
- [ ] Caching strategy for repeated content?
- [ ] How to train custom judge model from human QA data?

---

## Phase 5.5: Context Support ✅ COMPLETE

### Implementation

```typescript
// Without context - warns, escalates ambiguous terms
mod.moderate("にがー");
// → action: "escalate", warnings: ["No context provided..."]

// With context - uses for disambiguation
mod.moderate("にがー", {
  context: ["コーヒー飲んだ", "めっちゃ濃かった"]
});
// → action: "allow" (council recognizes "bitter")
```

### Features
- ✅ `ModerateOptions` type with `context`, `userId`, `platform`
- ✅ Console warning on first call without context
- ✅ `warnings` array in response
- ✅ `contextProvided` boolean in response
- ✅ Ambiguous terms without context → ESCALATE (not DENY)
- ✅ Context passed to council for disambiguation

### Behavior
| Input | Context | Action |
|-------|---------|--------|
| Short ambiguous term | ❌ None | ESCALATE + warning |
| Short ambiguous term | ✅ Provided | Normal processing |
| Clear violation | ❌ None | DENY (still catches obvious) |

---

## Phase 6: Scale & Performance (TODO)

### 6.1 Hold Action for Async Council
Return `action: "hold"` when council is needed, with callback for final decision.

```typescript
const result = await mod.moderate(text);
if (result.action === 'hold') {
  // Show to sender only (app implements this)
  result.onDecision((final) => {
    // Council finished - app handles final action
  });
}
```

### 6.2 Caching
- Cache exact text → result mapping
- Configurable TTL
- LRU eviction

### 6.3 Blocklist Database
- Add terms to instant-deny list
- Pattern matching (regex support)
- Import/export

### 6.4 Learning from Decisions
- Council denies → pattern added to fast-path
- Human reviews → improves model over time
- Feedback loop: `mod.learnFromDecision(text, 'deny')`

### 6.5 Batch Processing (Shelved with Image Mod)
- `moderateBatch(texts[], { concurrency })` for backlog scanning
- Progress callbacks
- Skip council option for speed

---

## Phase 7: Bias & False Positive Audit (TODO)

Systematic testing for:
- [ ] Linguistic false positives (e.g., `にがー` = "bitter" vs slur)
- [ ] Cultural context gaps
- [ ] Over-flagging of reclaimed terms
- [ ] Under-flagging of coded language
- [ ] Regional slang variations
- [ ] Cross-language phonetic collisions

See `EXPERIMENTS.md` for tracked cases.

---

## Technical Debt / Future Improvements

### Context Detection
Current approach uses regex patterns (crude):
```typescript
const EDUCATIONAL_PATTERNS = [
  /\b(historically|etymology|linguistic)\b/i,
  // ...
];
```

**Better approaches to consider:**
1. **LLM-based context detection** — Ask the LLM to classify intent (adds latency)
2. **Embedding similarity** — Compare to examples of educational/reclamation use
3. **Small fine-tuned classifier** — Fast, but needs labeled training data

**Recommendation:** For cases where context matters, skip fast-path and let API/Council handle it. Reserve fast-path for unambiguous cases only.

---

## References

- [OpenAI Moderation API](https://platform.openai.com/docs/guides/moderation)
- [Google Perspective API](https://perspectiveapi.com/)
- [Anthropic Claude](https://docs.anthropic.com/)
- [Llama Guard](https://ai.meta.com/research/publications/llama-guard-llm-based-input-output-safeguard-for-human-ai-conversations/)
- [Unicode Confusables](https://unicode.org/reports/tr39/#Confusable_Detection)
