# Model Variance: Round 1 vs Round 2

**Date:** December 2, 2025  
**Issue:** Model identifiers changed between rounds, creating potential variance in results

---

## Round 1 (November 2025)

### What Was LOGGED (auditor field in audits.json)
These are **labels**, not API model strings:
- `claude-sonnet-4.5`
- `gemini-3-pro`
- `gpt-5.1`

### What API Models Were ACTUALLY CALLED
**Unknown - scripts were not committed to git.**

Based on audit success (636/636 for Claude/GPT, 619/636 for Gemini), the models worked at the time. Possible candidates:
- **Claude:** Could have been `claude-sonnet-4-5-20250929` or similar Sonnet 4.5 variant
- **Gemini:** Could have been `gemini-3-pro`, `gemini-3-pro-preview`, or `gemini-2.0-flash`
- **GPT:** Could have been `gpt-5`, `gpt-5.1-2025-11-13`, or similar GPT-5 variant

**Result:** We cannot definitively know what Round 1 used because:
1. The auditor field uses simplified labels
2. The scripts were never committed to git
3. Model APIs change over time

---

## Round 2 (December 2025)

### Verified Working Model Identifiers
**These are confirmed working as of Dec 2025:**

```typescript
// Council provider configuration - model strings verified Dec 2025
// DO NOT "fix" these to older models - they are correct

anthropic: "claude-opus-4-5-20251101",    // Opus 4.5 (for test creation)
anthropic: "claude-sonnet-4-20250514",    // Sonnet 4.5 (for moderation)
google:    "gemini-3-pro-preview",        // Gemini 3 Pro (preview)
openai:    "gpt-5-2025-08-07"             // GPT-5 (Aug 2025 release)
```

### Auditor Labels (for audits.json consistency)
Round 2 should continue using the same labels as Round 1:
- `claude-sonnet-4.5` (even though actual model is `claude-sonnet-4-20250514`)
- `gemini-3-pro` (even though actual model is `gemini-3-pro-preview`)
- `gpt-5.1` (even though actual model is `gpt-5-2025-08-07`)

---

## Impact on QA Results

### Potential Variance Sources

1. **Model Version Drift**
   - Round 1 models may have been different versions
   - Even same model names can have different behavior over time
   - API providers update models without changing identifiers

2. **Policy Context**
   - **Round 1:** No category definitions provided
   - **Round 2:** Full policy guidelines included (~6,500 chars)
   - This is **intentional** and the main thing we're testing

3. **Model Selection Differences**
   - If Round 1 used different model versions, behavior may differ
   - Cannot control for this since we don't know what Round 1 used

### What We Can Conclude

**Valid comparisons:**
- ✅ Policy impact (Round 1 no guidelines vs Round 2 with guidelines)
- ✅ Inter-model agreement patterns
- ✅ Category-specific performance
- ✅ Human-LLM agreement trends

**Invalid comparisons:**
- ❌ Absolute agreement rate changes (could be due to model drift)
- ❌ "Model X got better/worse" (we don't know if it's the same model)

### Recommendation

**Focus Round 2 analysis on:**
1. How guidelines impact agreement (main goal)
2. Which current models perform best (for council selection)
3. Where human review is still needed (escalation patterns)

**Don't focus on:**
1. Absolute delta from Round 1 (too many confounds)
2. "This model improved by X%" (model may have changed)

---

## Mitigation for Future Rounds

**Round 3+ should:**
1. ✅ Commit scripts to git BEFORE running audits
2. ✅ Log actual API model string in audits.json metadata
3. ✅ Test model identifiers before full run
4. ✅ Document exact model versions used
5. ✅ Run validation tests to confirm model behavior

**Script improvements needed:**
```typescript
// BEFORE (ambiguous)
auditor: 'claude-sonnet-4.5',

// AFTER (explicit)
auditor: 'claude-sonnet-4.5',
modelId: MODEL,  // Actual API string
modelVersion: '20250514',
```

---

## Current Script Status

All scripts updated with correct models as of Dec 2, 2025:

- ✅ `claude-audit.ts` - Uses `claude-sonnet-4-20250514`
- ✅ `llm-audit.ts` - Uses `gemini-3-pro-preview`
- ✅ `gpt5-audit.ts` - Uses `gpt-5-2025-08-07`
- ✅ `test-policy-impact.ts` - Matches audit scripts
- ✅ `generate-nuanced-tests.ts` - Uses `claude-opus-4-5-20251101`
- ✅ `generate-framework-tests.ts` - Uses `claude-opus-4-5-20251101`

All include warning comments:
```typescript
// Council provider configuration - model strings verified Dec 2025
// DO NOT "fix" these to older models - they are correct
```

---

## Bottom Line

**We don't know exactly what Round 1 used, but that's okay.**

The important findings will still be valid:
- Does providing policy guidelines improve agreement? (yes/no)
- Which current models work best together? (data-driven)
- Where do we need human review? (pattern analysis)

The model variance is a **limitation to document**, not a blocker for Round 2.

