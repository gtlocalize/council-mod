# council-mod Development Plan

## Important Notes

**child_safety Category Exclusion:**
The `child_safety` category has been **excluded from QA testing** due to the extreme sensitivity of generating test content that could resemble CSAM-related material. This category remains in the library's detection capabilities, but will not have automated test coverage. Any testing of this category should be done by specialized organizations with proper ethical oversight and legal clearances.

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

## Phase 2.9: Test Case Generation Improvements (TODO)

### Context Bias Fix

**Current issue:** All context cases are "looks bad → context excuses it"

**Needed distribution for next generation:**
```
Context cases breakdown:
  60% - Context exonerates (current pattern)
  25% - Context condemns (NEW)
  10% - Context neutral/irrelevant (NEW)  
  5%  - Bad regardless of context (NEW)
```

**Generation prompts to add:**

```typescript
// Context that makes it WORSE
"Generate cases where the message seems borderline, but context reveals 
it's part of harassment, stalking, or escalating threats."

// Context that's IRRELEVANT
"Generate cases where the message is clearly bad, and context exists 
but doesn't excuse it (e.g., self-harm message with casual context)."

// Bad REGARDLESS
"Generate cases with clear violations where no amount of context 
could excuse it (explicit threats, severe slurs directed at someone)."
```

**See Phase 7 for detailed examples and rationale.**

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

## Phase 5.8: Moderation Philosophy Modes (TODO)

**Problem:** Different platforms have different moderation philosophies:
- **Interpersonal safety:** Chat apps, Discord (flag directed harm only)
- **Platform content:** YouTube, TikTok (flag disturbing content period)

**Key Distinction:**

| Statement | Interpersonal Mode | Platform Mode | Why Different |
|-----------|-------------------|---------------|---------------|
| "I want to see people tortured" | ALLOW | DENY/ESCALATE | Personal expression vs content standards |
| "You should be tortured" | DENY | DENY | Directed harm - both flag |
| "Here's how to torture someone" | DENY | DENY | Actionable instruction - both flag |

**Implementation:**

```typescript
interface ModerationMode {
  mode: 'interpersonal-safety' | 'platform-content' | 'custom';
  
  // Granular controls
  allowPersonalExpression: boolean;  // "I want X" vs "Do X"
  requireDirectTarget: boolean;      // Must target someone to flag
  brandSafetyMode: boolean;          // Flag disturbing content regardless
  
  // Per-category overrides
  categoryModes?: {
    violence: { requireTarget: boolean };
    hate_speech: { allowDiscussion: boolean };
  };
}

// Presets
const INTERPERSONAL_SAFETY: ModerationMode = {
  mode: 'interpersonal-safety',
  allowPersonalExpression: true,
  requireDirectTarget: true,
  brandSafetyMode: false,
};

const PLATFORM_CONTENT: ModerationMode = {
  mode: 'platform-content',
  allowPersonalExpression: false,  // Flag disturbing content
  requireDirectTarget: false,       // Flag even if not directed
  brandSafetyMode: true,
};
```

**Impact on Categories:**

| Category | Mode Impact |
|----------|-------------|
| threats | None - always flag directed threats |
| violence | HIGH - personal expression vs glorification |
| hate_speech | MEDIUM - "I hate X" vs discussing hatred |
| harassment | None - by definition directed |
| sexual_harassment | None - by definition directed |
| self_harm | LOW - "I feel suicidal" vs encouraging |

**See CATEGORY_DEFINITIONS.md** for detailed mode-specific examples.

---

## Phase 5.9: Custom Guidelines & Category Mapping (TODO)

**Problem:** Different platforms have different moderation policies. Our 11 categories are a sensible default, but users need to map their custom guidelines to our system.

**Example Use Cases:**
- Gaming platform: "toxic behavior" maps to harassment + hate_speech
- News site: Different standards for comments vs articles
- Kids platform: Much stricter thresholds, custom categories
- Professional network: "unprofessional conduct" category

**Proposed API:**

```typescript
interface CustomCategory {
  name: string;  // User's category name
  description: string;
  mapsTo: ModerationCategory[];  // Which of our 11 categories this represents
  threshold: number;  // Custom deny threshold for this category
  examples: {
    allow: string[];
    deny: string[];
    escalate: string[];
  };
}

interface CustomGuidelines {
  categories: CustomCategory[];
  platformContext: string;  // "gaming", "professional", "kids", etc.
  culturalContext?: string;  // Region-specific norms
}

// Usage
const moderator = new Moderator({
  openaiApiKey: process.env.OPENAI_API_KEY,
  customGuidelines: {
    categories: [
      {
        name: "toxic_behavior",
        description: "Gaming toxicity including trash talk, griefing encouragement",
        mapsTo: ['harassment', 'hate_speech', 'threats'],
        threshold: 0.6,  // Stricter than default 0.7
        examples: {
          deny: ["go kill yourself noob", "uninstall trash"],
          escalate: ["you suck at this game"],
          allow: ["gg wp", "that was a bad play"],
        },
      },
      {
        name: "cheating_discussion", 
        description: "Discussion of game exploits or cheating",
        mapsTo: ['spam_scam'],  // Closest fit
        threshold: 0.5,
        examples: {
          deny: ["DM me for aimbot", "here's how to dupe items"],
          allow: ["the devs should fix this exploit"],
        },
      },
    ],
    platformContext: "gaming",
  },
});

// System maps user's custom categories to our detection categories
// Returns results in both formats
const result = await moderator.moderate("go kill yourself noob");
console.log(result.categories);  // Standard: { threats: 0.9, harassment: 0.8 }
console.log(result.customCategories);  // Custom: { toxic_behavior: 0.85 }
```

**Implementation:**

1. **Custom category mapping layer**
   - Maps user categories to our 11 standard categories
   - Aggregates scores from multiple mapped categories
   - Applies custom thresholds

2. **LLM prompt enhancement**
   - Include custom guidelines in moderation prompt
   - "This platform defines 'toxic behavior' as..."
   - Use examples to guide LLM

3. **Dual result format**
   - Standard categories (for our system)
   - Custom categories (for user's system)
   - Both in the response

4. **Guidelines validation**
   - Ensure custom categories map to at least one standard category
   - Warn if examples are ambiguous
   - Suggest closest standard category matches

**Benefits:**
- Users keep their terminology ("toxic", "NSFW", "unprofessional")
- We provide consistent detection backend
- Custom thresholds per category
- Platform-specific tuning

**Challenges:**
- Mapping quality varies with description quality
- LLM prompt length increases
- Category conflicts (custom category spans multiple standard ones)

**Future:** Train on custom guidelines over time, fine-tune per-platform models.

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

### 6.6 Audit CLI Enhancement (TODO)

**Current state:** Basic linear audit - loads all cases, audits sequentially, saves progress.

**Needed:** Multi-functional audit management system.

#### Audit Sets
Create named subsets of cases for targeted auditing:

```typescript
// Create audit sets
npm run audit -- --create-set "sample-50" --random 50
npm run audit -- --create-set "japanese-only" --filter language=ja
npm run audit -- --create-set "hate-speech-edge" --filter category=hate_speech,type=edge
npm run audit -- --create-set "disagreements" --where "gemini!=claude"

// Audit a specific set
npm run audit -- --set "sample-50"

// List available sets
npm run audit -- --list-sets
```

#### Multi-functional Operations

**Set Management:**
- Create sets with filters (category, type, language, random sampling)
- Load/save named sets
- Compare sets (overlap analysis)

**Audit Operations:**
- Audit specific set (not all 550 cases)
- Re-audit cases (override existing audits)
- Batch audit with multiple auditors
- Resume from interruption (already works)

**Review Operations:**
- View specific case by ID
- Compare audits for same case (human vs LLM)
- Filter cases by disagreement
- Export disagreements to CSV

**Statistics:**
- Progress by auditor
- Agreement rates
- Time estimates
- Audit quality metrics

#### Implementation Ideas

```typescript
interface AuditSet {
  name: string;
  description?: string;
  caseIds: string[];
  filters?: {
    categories?: ModerationCategory[];
    types?: TestCaseType[];
    languages?: TestLanguage[];
  };
  createdAt: string;
  createdBy: 'human' | string;
}
```

**UI Approach: Interactive menus, not CLI flags**

Current pattern (good):
```
[A] Allow    [D] Deny     [E] Escalate
[S] Skip     [B] Back     [Q] Quit & Save
```

Future pattern (similar):
```
Main Menu:
  [1] Start Audit
  [2] Create Audit Set
  [3] Compare Auditors
  [4] View Statistics
  [5] Export Data
  [Q] Quit

Create Set Menu:
  [1] Random Sample (enter N)
  [2] Filter by Category
  [3] Filter by Language
  [4] Find Disagreements
  [B] Back to Main Menu
```

**Navigation:**
- Arrow keys / numbers for menu selection
- [B] Back to previous menu
- [Q] Quit (with confirmation)
- [?] Help for current screen
- Clear visual hierarchy with boxes and colors

**NOT this** (flags are developer-y, not user-friendly):
```bash
# ❌ Too many flags, hard to remember
audit --create-set "sample" --filter category=hate_speech --random 50
```

**Instead this** (guided workflow):
```
Welcome to Audit CLI
[1] Start Audit
[2] Manage Sets
> 2

Audit Sets
[1] Create New Set
[2] View Existing Sets
[3] Delete Set
> 1

Create Set: How many cases?
[1] All cases (550)
[2] Random sample (enter number)
[3] Filtered subset
> 2

Enter number: 50

Create Set: Filters?
[1] All categories
[2] Specific category (select)
[3] Specific type (select)
> 1

Set created: "random-50" (50 cases)
Press Enter to continue...
```

#### Use Cases

**Sample audits:** "Audit 50 random cases to check quality before running all 550"
**Targeted review:** "Re-audit all cases where Gemini and Claude disagreed"
**Language-specific:** "Audit only Japanese cases with a Japanese speaker"
**Category deep-dive:** "Focus audit on hate_speech edge cases"
**Disagreement resolution:** "Human review of all 3-way disagreements"

#### Benefits
- Faster iteration (audit subsets, not all 550)
- Targeted QA (focus on problem areas)
- Better workflow (review disagreements, re-audit)
- Flexibility (create custom audit scenarios)

---

### 6.7 Category Severity & Multi-Violation Tracking (TODO)

**Status:** Deferred until after baseline QA round. Current QA focuses on core decisions (Allow/Deny/Escalate) to establish calibration before adding category granularity.

**Problem:** "Cross" type cases violate multiple categories, but we only track one. When denying, we should specify WHICH category was the primary reason.

**Use cases:**
- Hate speech + threats → Deny for "threats" (more severe)
- Harassment + sexual content → Deny for "sexual_harassment"
- Multiple violations → Auditor picks ONE primary category (forced choice)

**Category Overlap Issue:**
Many cases span multiple categories with fuzzy boundaries:
- "I'm gonna cut your head off" = Violence? Threats? Both?
- Racial slur + physical threat = Hate speech? Violence?
- Sexual harassment + doxxing = Which is primary?

**Solution:** Clear category definitions + configurable severity ranking

**Implementation:**

```typescript
interface ModerationResult {
  action: 'allow' | 'deny' | 'escalate';
  // NEW: Primary violation (if denied/escalated)
  primaryCategory?: ModerationCategory;
  // NEW: All detected violations with severities
  violations: {
    category: ModerationCategory;
    severity: number;
    confidence: number;
  }[];
  // Existing fields...
}

// Configurable severity ranking (default provided)
interface CategoryConfig {
  severityRanking: ModerationCategory[];  // Highest to lowest
  // Example default:
  // ['child_safety', 'threats', 'violence', 'hate_speech', 
  //  'self_harm', 'sexual_harassment', 'harassment', 
  //  'drugs_illegality', 'doxxing', 'spam_scam', 'profanity']
}
```

**QA Changes:**

Human audit CLI - Two-step deny process:
```
Step 1: [D] Deny

Step 2: Primary reason? (pick ONE)
  → [1] Hate Speech
  → [2] Harassment  
  → [3] Sexual Harassment
  → [4] Violence
  → [5] Threats
  → [6] Drugs/Illegality
  → [7] Self-Harm
  → [8] Child Safety
  → [9] Spam/Scam
  → [10] Profanity
  → [11] Personal Info/Doxxing
```

**Audit Data Structure:**
```typescript
interface Audit {
  caseId: string;
  auditor: 'human' | 'gemini-3-pro' | string;
  action: AuditAction;
  primaryCategory?: ModerationCategory;  // NEW - ONE category per deny
  confidence?: number;
  reasoning?: string;
  timestamp: string;
}
```

**Prerequisites:**
1. **Define category boundaries** - Clear definitions for each category
2. **Establish severity ranking** - Default order (configurable)
3. **Create decision tree** - When content fits multiple categories, which takes priority?

**Benefits:**
- More granular QA data
- Better agreement metrics (did human and LLM deny for same reason?)
- Improved transparency (why was this denied?)
- Analytics on which categories are hardest to detect
- Category-specific performance tracking

---

## Phase 7: Bias & False Positive Audit (TODO)

Systematic testing for:
- [ ] Linguistic false positives (e.g., `にがー` = "bitter" vs slur)
- [ ] Cultural context gaps
- [ ] Over-flagging of reclaimed terms
- [ ] Under-flagging of coded language
- [ ] Regional slang variations
- [ ] Cross-language phonetic collisions

### **Known Test Bias: Context Always Excuses** ⚠️

**Current problem:** All test cases with `context` are designed to show "looks bad alone → context makes it innocent."

**Example:**
```
Text: "にがー"
Context: ["コーヒー飲んだ", "めっちゃ濃かった"]
Result: ALLOW (context shows it means "bitter")
```

**Missing scenarios:**

| Scenario | Example | Expected | Current Coverage |
|----------|---------|----------|------------------|
| **Context excuses** | "にがー" + coffee context | ALLOW | ✅ Have this |
| **Context condemns** | "You're trash" + harassment history | DENY | ❌ Missing |
| **Context neutral** | "You suck" + unrelated context | DENY | ❌ Missing |
| **Bad regardless** | Explicit threat + any context | DENY | ❌ Missing |

**Real examples needed:**

1. **Context makes it worse:**
   ```
   Text: "You better watch out"
   Context: ["I know where you live", "I've seen your family"]
   → Should be DENY (escalating threats)
   ```

2. **Context is irrelevant:**
   ```
   Text: "Kill yourself"
   Context: ["How was your day?", "Weather is nice"]
   → Should be DENY (context doesn't excuse self-harm)
   ```

3. **Bad with clarifying context:**
   ```
   Text: "You fucking idiot"
   Context: ["Stop messaging me", "This is the 5th time today"]
   → Should be DENY (harassment, context confirms pattern)
   ```

4. **Reclamation attempt but still attacking others:**
   ```
   Text: "As a gay man, those f*ggots are ruining our community"
   Context: ["I'm tired of the activists"]
   → Should be DENY (in-group doesn't excuse attack)
   ```

**Why this matters:**

Current bias trains auditors (human and LLM) to think:
- **Has context = probably innocent** ❌
- **No context = uncertain** ❌

Reality should be:
- **Context can excuse, condemn, or be irrelevant** ✅

**Action items for next test generation:**
- [ ] Generate "context makes it worse" cases
- [ ] Generate "context is neutral" cases  
- [ ] Generate "bad regardless of context" cases
- [ ] Ensure ~40% of context cases still result in DENY/ESCALATE
- [ ] Balance: 60% context→ALLOW, 40% context→DENY/ESCALATE

**Impact on current audit:**
- Current round is still valid (measures baseline agreement)
- But results may show artificially high ALLOW rate for context cases
- Note this limitation when analyzing agreement metrics
- Fix in next test generation round

See `EXPERIMENTS.md` for tracked cases.

---

## Technical Debt / Future Improvements

### Category Definitions & Boundaries ✅ COMPLETE

**Status:** Formal definitions documented in [`CATEGORY_DEFINITIONS.md`](./CATEGORY_DEFINITIONS.md)

**Problem:** Categories have fuzzy boundaries and no formal definitions.

**Examples of overlap:**
- "I'm gonna cut your head off" — Violence? Threats? Both?
- Racial slur + "I'll kill you" — Hate speech? Threats? Violence?
- "You're ugly and stupid, no one will ever love you" — Harassment? Bullying? Emotional abuse?
- Unsolicited sexual advance — Sexual harassment? Harassment?
- "Send me your address so I can come find you" — Threats? Doxxing attempt?

**Current categories (no formal definitions):**
```typescript
const MODERATION_CATEGORIES = [
  'hate_speech',          // Attacks based on protected characteristics?
  'harassment',           // Repeated unwanted contact? Any hostility?
  'sexual_harassment',    // Unwanted sexual advances/comments?
  'violence',             // Graphic descriptions? Physical harm?
  'threats',              // Intent to harm? Conditional? Direct?
  'self_harm',            // Suicide ideation? Self-injury? Eating disorders?
  'drugs_illegal',        // Drug sales? Drug use discussion? Which drugs?
  'profanity',            // Any swear words? Context-dependent?
  'personal_info',        // PII? Doxxing? Phone numbers?
  'child_safety',         // CSAM indicators? Grooming? What age threshold?
  'spam_scam',            // Unsolicited ads? Phishing? MLM?
];
```

**Need to define:**
1. **Clear boundaries** for each category
2. **Precedence rules** when multiple categories apply
3. **Examples** of edge cases and how to categorize them
4. **Decision tree** for overlapping content

**Default severity ranking (for multi-category cases):**
```
1. child_safety      (highest priority)
2. threats
3. violence
4. self_harm
5. hate_speech
6. sexual_harassment
7. harassment
8. drugs_illegal
9. personal_info
10. spam_scam
11. profanity        (lowest priority)
```

**COMPLETED:**
- [x] Write formal definitions for each category
- [x] Create decision matrix for overlaps
- [x] Document edge cases with examples
- [x] Establish severity ranking (child_safety → profanity)
- [x] Decision trees for multi-category content
- [x] Configuration recommendations by platform type

**See:** [`CATEGORY_DEFINITIONS.md`](./CATEGORY_DEFINITIONS.md) for complete reference

---

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
