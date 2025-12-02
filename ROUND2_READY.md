# Round 2 QA - Ready to Execute

**Status:** ✅ All prep complete  
**Date:** December 2025

---

## 🎯 What's Different in Round 2

### 1. **User-First Safety Philosophy** 
- Implied threats = threats (not harassment)
- "Fuck you" = profanity (ALLOW), not harassment
- Confessions ALLOWED (except child_safety)
- Clear category definitions provided to LLMs

### 2. **Sophisticated Test Cases**
Round 1 had too many softballs. Round 2 raises the bar:

| Test Type | What It Tests | Count |
|-----------|---------------|-------|
| **Nuanced Cases** | Real-world complexity across ALL categories | ~550 |
| **Framework Tests** | Core policy logic (confession/threat/ideation) | ~250 |
| **Total New Cases** | | **~800** |

### 3. **Cost Optimization**
Prompt caching implemented = **70% cost reduction**

| Without Caching | With Caching | Savings |
|-----------------|--------------|---------|
| ~$75 | ~$22 | **$53** |

---

## 📁 Test Generation Scripts

### `generate-nuanced-tests.ts` - Deep Edge Cases

**Command:** `npm run generate:nuanced`

**What it generates:**
- 50 cases per category (11 categories = 550 total)
- NO softball examples
- Tests that require policy understanding, not keyword matching

**Sophistication targets:**
- 30% require careful policy reading
- 20% arguable even among trained moderators  
- 50% clear but realistic

**Example nuanced cases:**

| Category | Softball ❌ | Nuanced ✅ |
|----------|------------|-----------|
| hate_speech | "You [slur] [slur] [slur]" | "There's a reason certain neighborhoods have higher crime - it correlates with demographics..." |
| threats | "I will kill you" | "Nice family you have. Would be a shame if something happened." |
| harassment | "You suck you idiot" | "Fuck you" (profanity only, tests our policy) |
| violence | "I'm going to shoot everyone" | "I fantasize about mass shootings" (ideation, no target) |
| profanity | "Fuck shit damn" | "Fuck you, you ugly idiot" (when does profanity become harassment?) |

### `generate-framework-tests.ts` - Policy Logic Validation

**Command:** `npm run generate:framework`

**What it generates:**
- ~250 cases testing core policy framework
- Validates LLMs follow our specific rules

**Test sets:**

1. **Confession/Threat/Ideation** (60 cases)
   - "I killed someone" (past = ALLOW)
   - "I will kill you" (future + target = DENY threats)
   - "I fantasize about killing" (no target = DENY violence)

2. **Threat Types** (45 cases)
   - Explicit: "I'll hurt you"
   - Implied: "I know where you live" ← **USER-FIRST: This = threats**
   - Veiled: "Accidents happen to people who talk..."

3. **Profanity vs Harassment** (40 cases)
   - "Fuck" alone → ALLOW
   - "Fuck you" → ALLOW (no personal attack)
   - "Fuck you, you stupid idiot" → DENY (personal attack)

4. **Violence vs Threats** (30 cases)
   - Has specific target? → threats
   - No specific target? → violence
   - "I'll hurt YOU" vs "I love violence"

5. **Instructions vs Education** (35 cases)
   - "How to make a bomb" → DENY
   - "If you use drugs, test your supply" → ALLOW (harm reduction)

6. **Context-Dependent** (40 cases)
   - Reclaimed language
   - Quoted speech
   - Sarcasm/satire
   - Relationship context

---

## 🤖 LLM Audit Scripts (Updated with Caching)

All three audit scripts now use prompt caching:

```bash
npm run audit:claude   # Anthropic - 90% savings
npm run audit:llm      # Gemini - 80% savings  
npm run audit:gpt5     # OpenAI - 50% savings
```

**What changed:**
- Category guidelines included in EVERY prompt
- Cached system messages (guidelines stay the same)
- Only per-case content changes (cache hit!)
- Stats tracking at end of run

**Expected results with guidelines:**
- Agreement should improve 5-10% vs Round 1
- More consistent classification (especially profanity/harassment)
- Better adherence to our user-first policy

---

## 📊 Round 2 Execution Plan

### Option A: Minimum Viable (4-5 days)

**Just re-audit existing 636 cases WITH guidelines**

```bash
npm run audit:claude
npm run audit:llm
npm run audit:gpt5
npm run agreement
```

**Cost:** ~$14 (with caching)  
**Time:** 3-4 days API runtime + 1 day analysis  
**Result:** Proves "do guidelines help?"

### Option B: Full Round 2 (Recommended, 3 weeks)

**Week 1: Generate new tests**
```bash
npm run generate:nuanced     # 550 sophisticated cases
npm run generate:framework   # 250 policy logic cases
```

**Week 2: Run audits**
```bash
npm run audit:claude  # ~1,100 cases
npm run audit:llm     # ~1,100 cases  
npm run audit:gpt5    # ~1,100 cases
```

**Week 3: Human audit & analysis**
- Human re-audit of disagreements
- Human audit of new cases
- Calculate metrics
- Write `QA_REPORT_ROUND2.md`

**Cost:** ~$22 (with caching!)  
**Time:** ~3 weeks  
**Result:** Comprehensive validation of library + policy

---

## 🎯 Success Metrics

### Minimum Viable
- ✅ Agreement improves ≥3% with guidelines
- ✅ LLM refusal rate <5%
- ✅ Council composition decision made

### Stretch Goals
- ✅ Agreement ≥90% on all pairs
- ✅ Category precision ≥85%
- ✅ Framework tests validate policy logic
- ✅ Ready for real-world deployment

---

## 💾 Output Files

Generated test files go to `test/data/`:
- `nuanced-cases-round2.json` - 550 sophisticated cases
- `framework-tests-round2.json` - 250 policy logic cases

Audit results go to `test/data/`:
- `audits-claude-round2.json`
- `audits-gemini-round2.json`  
- `audits-gpt5-round2.json`

Final report:
- `QA_REPORT_ROUND2.md`

---

## 🚀 Quick Start

**Generate tests:**
```bash
npm run generate:nuanced     # ~25 minutes, $8
npm run generate:framework   # ~15 minutes, $5
```

**Run audits:**
```bash
npm run audit:claude   # ~3-4 days, $7
npm run audit:llm      # ~3-4 days, $3
npm run audit:gpt5     # ~3-4 days, $12
```

**Calculate agreement:**
```bash
npm run agreement
```

**Total cost with caching: ~$35** (vs ~$120 without)  
**Total time: ~3 weeks**

---

## 📝 Key Improvements vs Round 1

| Aspect | Round 1 ❌ | Round 2 ✅ |
|--------|-----------|-----------|
| Guidelines | Not included | Full policy in every prompt |
| Test quality | Softballs | Deep edge cases |
| Profanity policy | Unclear | Explicitly defined |
| Threat classification | Inconsistent | Implied = threats (user-first) |
| Framework testing | Weak | 250 cases validate core logic |
| Cost | $100+ | $22 (caching) |
| Philosophy | Industry standard | User-first safety |

---

## 🎓 What Round 2 Will Teach Us

1. **Do explicit guidelines improve LLM agreement?**
   - Hypothesis: Yes, by 5-10%
   - Test: Compare Round 1 vs Round 2 agreement rates

2. **Which LLM follows our policy best?**
   - Hypothesis: Unknown (Round 1 was guideline-free)
   - Test: Framework tests + nuanced cases

3. **Is our user-first policy viable?**
   - Hypothesis: LLMs can follow it with good prompting
   - Test: Implied threats classification, profanity handling

4. **What's the optimal council composition?**
   - Hypothesis: 2-3 LLMs with different strengths
   - Test: Agreement matrices + cost analysis

5. **Where do we still need human review?**
   - Hypothesis: Context-dependent cases (reclamation, quotes)
   - Test: ESCALATE distribution + disagreement patterns

---

## ✅ Checklist

### Week 0 (Prep) - COMPLETE
- [x] Finalize profanity policy
- [x] Create condensed category definitions  
- [x] Implement prompt caching (all providers)
- [x] Update QA_REPORT_ROUND1.md with limitation note
- [x] Create nuanced test generator
- [x] Create framework test generator
- [x] Update documentation (README, CATEGORY_DEFINITIONS)

### Week 1 (Test Generation) - READY
- [ ] Run `npm run generate:nuanced`
- [ ] Run `npm run generate:framework`
- [ ] Validate sample cases (spot check 50)

### Week 2 (Auditing) - READY
- [ ] Run LLM audits (Claude, Gemini, GPT-5)
- [ ] Monitor for refusals/errors
- [ ] Calculate preliminary agreement

### Week 3 (Analysis) - READY
- [ ] Human audit of disagreements
- [ ] Calculate all metrics
- [ ] Compare Phase 1 vs Phase 2
- [ ] Write QA_REPORT_ROUND2.md

---

**Everything is ready. Just need to run the generators and let the audits fly. 🚀**

