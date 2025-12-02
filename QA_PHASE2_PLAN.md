# QA Phase 2 - Detailed Plan

**Goal:** Test LLM policy compliance with full category definitions  
**Timeline:** 2-3 weeks  
**Prerequisites:** Phase 1 complete, findings documented

---

## Phase 2 Overview

**What Phase 1 measured:**
- LLM internal policies vs human judgment
- Base-level agreement without explicit guidelines

**What Phase 2 will measure:**
- LLM policy compliance WITH our category definitions
- Impact of explicit guidelines on agreement rates
- Optimal council composition with guidelines

**Key question:** Does sending CATEGORY_DEFINITIONS.md improve agreement?

---

## Pre-Phase 2: Policy Finalization (Week 0)

### Task 1: Lock Down Profanity Policy

**Current issue:** Unclear if profanity should be ALLOW or DENY by default

**Phase 1 finding:** Human denied profanity, LLMs allowed it (10 cases)

**Decision needed:**

| Option | Default Behavior | Rationale |
|--------|------------------|-----------|
| **A. ALLOW by default** | Most platforms don't care | Common on Discord, gaming, adult platforms |
| **B. DENY by default** | Stricter standard | Kid-friendly, corporate, brand-safe platforms |
| **C. ESCALATE by default** | Let human decide | Safest but increases queue |

**Decision:** ✅ **ALLOW by default, configurable to DENY**

```typescript
// Default (most platforms)
const moderator = new Moderator({
  categories: {
    profanity: 'allow',  // Track but don't deny
  }
});

// Family-friendly mode (sponsored events, kids platforms)
const moderator = new Moderator({
  categories: {
    profanity: 'deny',  // Block all profanity
  }
});

// Escalate for review
const moderator = new Moderator({
  categories: {
    profanity: 'escalate',  // Human decides
  }
});
```

**API behavior when profanity is denied:**
```typescript
const result = await moderator.moderate("Holy shit!");

// If profanity: 'allow' (default)
result.action = 'allow'
result.categories.profanity = 0.8  // Tracked but not denied

// If profanity: 'deny'
result.action = 'deny'  // ← ALLOW switches to DENY
result.deniedFor = 'profanity'
```

**Update to CATEGORY_DEFINITIONS.md:**
```markdown
## profanity

**Default policy:** ALLOW (track but don't deny)

**Rationale:** Profanity is context and platform dependent. Most modern 
platforms allow profanity in user-to-user communication. Enable strict 
profanity filtering via config for family-friendly platforms.

**Configuration:**
- allow: Track profanity but don't deny (default)
- deny: Block all strong profanity
- escalate: Send to human review
```

**Timeline:** 1-2 hours

---

### Task 2: Create Condensed Category Definitions for Prompts

**Current:** CATEGORY_DEFINITIONS.md is ~700 lines (too long for every prompt)

**Need:** Condensed version (~500-800 tokens) that fits in prompts

**Structure:**
```typescript
const CONDENSED_DEFINITIONS = `
MODERATION POLICY (Interpersonal Safety Mode)

CORE PRINCIPLES:
- Confessions (past tense: "I did X") = ALLOW (except child_safety)
- Threats (future tense: "I will do X to you") = DENY
- Personal expression ("I want to see X") = ALLOW
- Directed harm ("You should experience X") = DENY

CATEGORIES (by severity):
1. child_safety - ALWAYS DENY: Sexual/exploitative content involving minors
2. threats - Intent to harm (includes implied: "I know where you live")
3. violence - Graphic descriptions, instructions. NOT confessions.
4. self_harm - Promoting/instructing self-harm or suicide
5. hate_speech - Attacks on protected groups (race, religion, gender...)
6. sexual_harassment - Unwanted sexual content directed at someone
7. harassment - Bullying, stalking, repeated unwanted contact
8. personal_info - Doxxing, sharing private info without consent
9. drugs_illegal - Promoting illegal drug sales/use
10. spam_scam - Fraud, scams, deceptive content
11. profanity - ALLOW by default (configurable)

KEY DISTINCTIONS:
- "I killed someone" (confession) → ALLOW
- "I will kill you" (threat) → DENY (threats)
- "Here's how to kill someone" (instruction) → DENY (violence)
- "I fantasize about killing people" (ideation) → DENY (violence), NOT threats
- "I want to see violence" (personal expression) → ALLOW

EDGE CASES → ESCALATE:
- Reclaimed language (in-group usage)
- Educational discussion
- Quoted speech
- Cultural context nuances
`;
```

**Validation:** Test that condensed version covers Round 1 disagreement patterns

**Timeline:** 1 day

---

### Task 3: Implement System Message Caching

**Goal:** Send definitions once, cache for all requests (reduce cost)

**Implementation:**
```typescript
// claude-audit.ts
const SYSTEM_MESSAGE = {
  role: 'system',
  content: CONDENSED_DEFINITIONS,
  cache_control: { type: 'ephemeral' }  // Claude caching
};

const response = await fetch('https://api.anthropic.com/v1/messages', {
  body: JSON.stringify({
    model: MODEL,
    system: [SYSTEM_MESSAGE],  // ← Cached
    messages: [{ role: 'user', content: prompt }],
  }),
});
```

**Cost savings:**
- First request: ~800 tokens (definitions)
- Subsequent: ~5 tokens (cache hit)
- 160x cost reduction on system message

**Timeline:** 1 day

---

## Phase 2.1: Test Generation Improvements (Week 1)

### Task 1: Regenerate Context Cases

**Current:** 136 context cases, biased distribution, no speaker attribution

**New generation:**
- 200 context cases (expand coverage)
- Speaker attribution: `{ speaker: 'same'|'other', text: string }`
- Balanced distribution:
  - 40% context condemns
  - 40% context exonerates
  - 20% context neutral/irrelevant
- Temporal ordering explicit (oldest → newest)
- Conversation type: `'1:1' | 'group' | 'public'`

**Script:** `generate-context-balanced.ts`

**Timeline:** 2 days (generation + validation)

---

### Task 2: Generate Confession/Ideation Test Cases

**Current:** Ad-hoc coverage of confession cases, found during audit

**New generation:**
- 50 confession cases (past tense violence/drugs/etc.)
- 50 ideation cases ("I fantasize about X")
- 50 instruction cases ("Here's how to X")
- Explicitly test the boundaries

**Categories to focus:**
- violence (confessions, ideation, instruction)
- drugs_illegal (harm reduction vs promotion)
- threats (implied vs explicit)

**Timeline:** 2 days

---

### Task 3: Platform Content Standards Test Cases

**Current:** All cases use Interpersonal Safety Mode assumptions

**New generation:**
- 100 cases specifically for Platform Content mode
- "I want to see violence" (personal expression) - tests mode difference
- Disturbing but not directed content
- Brand safety edge cases

**Timeline:** 1-2 days

---

## Phase 2.2: Audit Infrastructure (Week 1-2)

### Task 1: Update LLM Audit Prompts

**Add to all audit scripts:**

```typescript
function getAuditPrompt(testCase: TestCase): string {
  return `${CONDENSED_CATEGORY_DEFINITIONS}

${testCase.context ? formatContext(testCase.context) : ''}

CONTENT TO EVALUATE:
"""
${testCase.text}
"""

Evaluate against the categories above. Respond with JSON:
{
  "action": "allow" | "deny" | "escalate",
  "category": "most_relevant_category_if_deny",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation referencing specific category rules"
}`;
}
```

**Changes:**
- Include full condensed definitions
- Ask for category identification
- Ask for reasoning that references specific rules

**Timeline:** 1 day

---

### Task 2: Enhance QA CLI (Interactive Menu)

**Current:** Flag-based (`--stats`, `--reset`)

**New:** Interactive menu-driven

```
╔════════════════════════════════════════╗
║   CONTENT MODERATION QA SYSTEM        ║
╚════════════════════════════════════════╝

[1] Start/Resume Human Audit
[2] Review Disagreements
[3] View Statistics
[4] Create New Audit Set
[5] Compare Auditors
[6] Export Results
[Q] Quit

Select option: _
```

**Features to add:**
- Main menu navigation
- Audit set creation (select specific categories, types, etc.)
- Inline statistics during audit
- Bookmarking cases for later review
- Confidence scoring (how sure are you?)

**Timeline:** 2-3 days

---

### Task 3: Add Confidence Scoring

**Current:** Human makes binary decisions without confidence

**New:** Human rates confidence on each decision

```
Your decision: D

How confident? [1=Guessing, 2=Unsure, 3=Confident, 4=Certain]: _
```

**Use cases:**
- Identify cases where human is uncertain
- Compare with LLM confidence scores
- Weight agreement metrics by confidence

**Timeline:** 1 day

---

## Phase 2.3: Multi-Auditor Validation (Week 2)

### Task 1: Human Auditor Preparation

**Current:** 1 human auditor (you) - keeping it this way for Phase 2

**No additional auditors for now** - Multi-auditor validation deferred to future rounds or research phase.

**Your prep:**
1. Review finalized CATEGORY_DEFINITIONS.md
2. Re-audit profanity cases with new policy (ALLOW by default)
3. Review disagreement cases with guidelines in mind

**Timeline:** 2-3 hours

---

## Phase 2.4: Execution (Week 2-3)

### Task 1: Run Phase 2 Audits

**With guidelines:**
```bash
npm run audit:llm -- --with-guidelines      # Gemini with definitions
npm run audit:claude -- --with-guidelines   # Claude with definitions
npm run audit:gpt5 -- --with-guidelines     # GPT-5.1 with definitions
```

**Test sets:**
- Original 636 cases (re-audit with guidelines)
- New 200 context cases (balanced, speaker attribution)
- New 150 confession/ideation cases
- New 100 Platform Content mode cases

**Total:** ~1,100 cases

**Timeline:** 3-4 days (API calls + rate limiting)

---

### Task 2: Human Audits

**You:** Re-audit disagreement cases (103 with GPT, 96 with Claude)  
**Additional auditors:** 200-case overlap subset

**Timeline:** 1 week

---

### Task 3: Comparative Analysis

**Metrics to calculate:**

1. **Agreement improvement:**
   - Phase 1 (no guidelines): 83.8-92.9%
   - Phase 2 (with guidelines): ?
   - Delta: How much did guidelines help?

2. **Category precision:**
   - Do LLMs now correctly identify violence vs threats?
   - Do they follow confession framework?

3. **Inter-annotator reliability:**
   - Human-to-human agreement (Gwet's AC1)
   - Identify "objectively hard" cases (all humans disagree)

4. **Cost-benefit:**
   - Guidelines add ~800 tokens/request
   - How much does agreement improve per $1 spent?

**Timeline:** 2-3 days

---

## Phase 2 Deliverables

### Code
- [ ] `condensed-definitions.ts` - 500-800 token category summary
- [ ] Updated audit scripts with guidelines
- [ ] Enhanced interactive CLI menu
- [ ] Confidence scoring in audits
- [ ] Disagreement review improvements
- [ ] Multi-auditor comparison scripts

### Data
- [ ] 200 new context cases (balanced, speaker attribution)
- [ ] 150 confession/ideation cases
- [ ] 100 Platform Content mode cases
- [ ] Phase 2 audit results (all auditors, with guidelines)
- [ ] Inter-annotator reliability data

### Reports
- [ ] `QA_REPORT_ROUND2.md` - Full analysis
- [ ] Comparison: Phase 1 vs Phase 2 agreement deltas
- [ ] Profanity policy recommendations
- [ ] Council composition recommendations (based on guideline-aware results)

---

## Implementation Checklist

### Week 0 (Prep)
- [ ] Finalize profanity policy (default: allow)
- [ ] Create condensed category definitions
- [ ] Implement system message caching
- [ ] Update QA_REPORT_ROUND1.md with missing guidelines limitation
- [ ] Recruit additional auditors

### Week 1 (Test Generation)
- [ ] Generate balanced context cases
- [ ] Generate confession/ideation cases
- [ ] Generate Platform Content mode cases
- [ ] Validate generation quality (sample 50)
- [ ] Enhance QA CLI with menu system

### Week 2 (Auditing)
- [ ] Run LLM audits with guidelines (Gemini, Claude, GPT-5.1)
- [ ] Calibration session with additional auditors
- [ ] Human audits on new cases (you + others)
- [ ] Review Phase 1 disagreements with guidelines

### Week 3 (Analysis)
- [ ] Calculate all agreement metrics
- [ ] Compare Phase 1 vs Phase 2 deltas
- [ ] Identify persistent disagreement patterns
- [ ] Create visualizations (heatmaps, confusion matrices)
- [ ] Write QA_REPORT_ROUND2.md

---

## Key Questions Phase 2 Will Answer

1. **Do explicit guidelines improve LLM agreement?** (expected: yes, by 5-10%)
2. **Which LLM follows guidelines best?** (currently unknown)
3. **Is Gemini still best with guidelines?** (or does GPT-5.1 improve more?)
4. **What's the optimal council composition?** (data-driven decision)
5. **How much do human annotators agree with each other?** (sets ceiling for LLM agreement)
6. **Which categories/types have lowest agreement?** (need better definitions?)
7. **Is profanity handling now consistent?** (after clarifying policy)

---

## Success Criteria

**Minimum viable:**
- ✅ All LLMs complete audits with <5% refusal rate
- ✅ Agreement improves by ≥3% with guidelines
- ✅ Human-human agreement measured (AC1 ≥ 0.80)
- ✅ Council composition decision made

**Stretch goals:**
- ✅ Agreement ≥90% on all pairs
- ✅ Category precision ≥85% (correct category identification)
- ✅ Platform Content mode tested
- ✅ Ready for real-world deployment testing

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Can't recruit auditors | Use Prolific/Upwork, or skip multi-auditor |
| Guidelines don't help | Still valuable negative result for paper |
| New test cases have errors | Sample validation before full audit |
| LLM refusals increase | Document as limitation, use human queue |
| Timeline slips | Prioritize core experiments, defer stretch goals |

---

## Post-Phase 2 Decisions

Based on results, decide:
1. **Council composition** - Which 2-3 LLMs to use in production
2. **Guideline strategy** - Full definitions, condensed, or tiered?
3. **Profanity handling** - Confirm default policy
4. **Ready for Phase 3?** - Real-world deployment testing, or need Phase 2.5?

---

## Phase 2 Budget

| Item | Cost |
|------|------|
| LLM API calls (~3,300 requests × $0.03 avg) | $100 |
| Time investment (30-40 hours) | Sweat equity |
| **Total** | **~$100** |

**Note:** Multi-auditor validation ($720) deferred to research phase or future rounds.

---

## Appendix: Condensed Definitions (Draft)

```
MODERATION POLICY - Interpersonal Safety Mode

CORE PRINCIPLES:
✓ Confessions (past): "I killed someone" → ALLOW (except child_safety)
✗ Threats (future): "I will kill you" → DENY
✓ Personal expression: "I want to see violence" → ALLOW
✗ Directed harm: "You should be hurt" → DENY
✗ Instructions: "Here's how to hurt someone" → DENY

SEVERITY RANKING:
1. child_safety - Sexual/exploitative content with minors (ALWAYS DENY confessions too)
2. threats - Intent to harm (explicit OR implied: "I know where you live")
3. violence - Graphic content, instructions, ideation ("I fantasize about mass shooting" = violence, not threats)
4. self_harm - Promoting/instructing self-harm
5. hate_speech - Attacks on protected groups
6. sexual_harassment - Unwanted sexual content directed at someone
7. harassment - Bullying, stalking, unwanted contact patterns
8. personal_info - Doxxing, sharing private info
9. drugs_illegal - Promoting illegal drug sales
10. spam_scam - Fraud, scams
11. profanity - Strong language (ALLOW by default)

EDGE CASES → ESCALATE:
- Reclaimed language by in-group members
- Educational/academic discussion
- Quoted speech without endorsement
- Cultural context you're uncertain about
- Ambiguous intent

EXAMPLES:
✓ "I got in a fight and hurt someone" - confession, allow
✗ "I'm gonna beat your ass" - threat, deny
✗ "Here's how to make a bomb" - instruction, deny
✓ "The word 'faggot' has been reclaimed by..." - educational, allow
✗ "nice tits you fucking idiot" (repeated) - sexual_harassment, deny
✓ "Holy shit that's amazing!" - profanity only, allow
? "As a gay man, I reclaim the word..." - escalate if uncertain about in-group status
```

**Word count:** ~350 words, ~500-600 tokens (fits comfortably in prompts)

---

## Next Steps

1. **Review this plan** - Adjust timeline/scope as needed
2. **Finalize profanity decision** - Choose default policy
3. **Create condensed definitions** - Get feedback before using
4. **Update QA_REPORT_ROUND1.md** - Add "missing guidelines" limitation
5. **Begin Phase 2 prep** - Start recruiting, finalizing policy

