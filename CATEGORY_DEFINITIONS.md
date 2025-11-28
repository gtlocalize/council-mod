# Content Moderation Category Definitions

**Version:** 1.0.0  
**Last Updated:** 2024-11-27

This document provides formal definitions for each moderation category, including boundaries, edge cases, and precedence rules for overlapping content.

---

## Moderation Philosophy

This library supports **two moderation approaches** through configuration:

### 1. Interpersonal Safety Mode (Default)

**Focus:** Protect users from directed harm (harassment, threats, attacks)

**Philosophy:**
- Personal expression/opinions are ALLOWED, even if disturbing
- Only flag when content **targets or impacts others**
- "I want X" → ALLOW (personal desire)
- "You should experience X" → DENY (directed)

**Use cases:** Chat apps, Discord, forums, community platforms

**Examples:**
| Text | Interpersonal Mode | Platform Mode |
|------|-------------------|---------------|
| "I want to see people tortured" | ALLOW | DENY |
| "You should be tortured" | DENY | DENY |
| "Violence is satisfying" | ALLOW | DENY |
| "I hate [group]" | DENY | DENY |
| "Here's how to hurt someone" | DENY | DENY |

### 2. Platform Content Standards Mode

**Focus:** Maintain platform-wide content standards (brand safety, community tone)

**Philosophy:**
- Remove disturbing content regardless of target
- Flag based on what content exists at all
- Advertiser-friendly, brand safety
- Lower tolerance for graphic/disturbing content

**Use cases:** YouTube, TikTok, Instagram, brand-conscious platforms

**Configuration:**

```typescript
const moderator = new Moderator({
  openaiApiKey: process.env.OPENAI_API_KEY,
  
  // Option 1: Simple mode selection
  moderationMode: 'interpersonal-safety',  // or 'platform-content'
  
  // Option 2: Granular control
  rules: {
    allowPersonalExpression: true,  // "I want X" is OK
    requireDirectTarget: true,       // Must target someone to flag violence
    brandSafetyMode: false,          // Don't flag for brand concerns
  },
});
```

**This document uses INTERPERSONAL SAFETY MODE as default.** Platform content standards require stricter interpretation of all categories.

---

## Severity Ranking

When content violates multiple categories, prioritize by this hierarchy (highest to lowest):

| Rank | Category | Rationale |
|------|----------|-----------|
| 1 | `child_safety` | Legal obligations, highest harm potential |
| 2 | `threats` | Immediate safety concern, credible danger (includes implied threats) |
| 3 | `violence` | Physical harm, graphic content |
| 4 | `self_harm` | Life-threatening content, crisis intervention needed |
| 5 | `hate_speech` | Targets protected groups, systemic harm |
| 6 | `sexual_harassment` | Unwanted sexual content, more severe than general harassment |
| 7 | `harassment` | Repeated unwanted contact, psychological harm |
| 8 | `personal_info` | Privacy violation, doxxing, safety risk |
| 9 | `drugs_illegal` | Illegal activity promotion |
| 10 | `spam_scam` | Financial harm, fraud |
| 11 | `profanity` | Language only, OPTIONAL (many platforms disable) |

**Usage:** When a case fits multiple categories, use the **highest-ranked** category as the primary classification.

---

## Category Definitions

### 1. child_safety

**Definition:** Content that endangers, sexualizes, exploits, or inappropriately targets minors (under 18).

**Must include at least one:**
- Sexual or romantic interest in minors
- CSAM (Child Sexual Abuse Material) indicators
- Grooming behavior or attempts
- Exploitation or endangerment of children
- Inappropriate adult-child interactions

**Does NOT include:**
- Age-appropriate content for minors
- General parenting discussion
- Child safety/education resources
- News reporting on child protection issues

**Edge Cases:**

| Example | Classification | Why |
|---------|----------------|-----|
| *(Examples omitted for safety)* | | See internal guidelines |

⚠️ **Note:** Specific examples for this category are intentionally omitted from public documentation due to sensitivity. Refer to internal moderation guidelines and legal counsel for case-by-case evaluation.

**Severity Considerations:**
- Explicit CSAM references: MAXIMUM (1.0)
- Grooming attempts: HIGH (0.8-0.9)
- Inappropriate comments: MEDIUM-HIGH (0.6-0.8)
- Borderline age-related content: MEDIUM (0.4-0.6)

**Precedence:** ALWAYS takes priority over all other categories.

---

### 2. threats

**Definition:** Communication expressing intent to cause physical, emotional, or material harm to a person, group, or property.

**Must include:**
- Statement of intent to harm (explicit OR implied)
- Identifiable target (person, group, location, or property)
- Reasonable interpretation as genuine threat

**Important:** Implied threats (e.g., "I know where you live") are treated as threats if context suggests danger.

**Does NOT include:**
- Hyperbolic expressions without credible intent
- Political rhetoric about policies
- Warnings about consequences (not threats)
- Competitive threats in business context

**Edge Cases:**

| Example | Classification | Why |
|---------|----------------|-----|
| "I'm gonna kill you" | threats | Direct threat of violence |
| "You better watch out" | CONTEXT-DEPENDENT | Could be warning OR threat |
| "I'll destroy you in this debate" | NOT threats | Figurative, competitive context |
| "Someone should deal with that guy" | ESCALATE | Indirect incitement, ambiguous |
| "I know where you live" | threats | Implicit threat with surveillance |
| "I hope you die" | NOT threats | Wish, not intent |
| "I'm going to ruin your career" | threats | Material harm, professional |

**Conditional vs. Unconditional:**
- **Conditional:** "If you do X, I'll do Y" → Usually NOT threats (warning of consequence)
- **Unconditional:** "I'm going to do Y to you" → threats
- **Exception:** "If you don't do X, I'll hurt you" → threats (coercion)

**Severity Considerations:**
- Specific, credible, immediate: MAXIMUM (0.9-1.0)
- Vague or distant: MEDIUM (0.6-0.8)
- Conditional/ambiguous: LOW-MEDIUM (0.4-0.6)

**Precedence:** Takes priority over violence, harassment, hate_speech.

---

### 3. violence

**Definition:** Content depicting, glorifying, or inciting physical harm, including graphic descriptions or imagery of injury, gore, or assault.

**Must include ONE of:**
- Graphic descriptions of harm **directed at or instructing harm to others**
- Glorification of violence **with incitement or targeting**
- Instructions for causing physical harm to others
- Detailed depictions of injury/death **intended to disturb**

**Does NOT include:**
- Personal expressions of preference (interpersonal mode)
- News reporting on violent events
- Historical discussion of violence
- Violence in fictional/entertainment context (clearly labeled)
- Self-defense instruction
- Medical/anatomical content

**Moderation Mode Impact:**

| Text | Interpersonal Safety | Platform Content |
|------|---------------------|------------------|
| "I want to see people tortured" | ALLOW | DENY/ESCALATE |
| "Violence in movies is great" | ALLOW | ALLOW |
| "Here's how to hurt someone" | DENY | DENY |
| "I'm going to hurt you" | DENY (→ threats) | DENY (→ threats) |

**Edge Cases:**

| Example | Classification | Why |
|---------|----------------|-----|
| "I'm gonna beat your ass" | threats (not violence) | Intent to harm, use threats category |
| "Here's how to throw a proper punch" | NOT violence | Educational self-defense |
| "The accident was gruesome, blood everywhere" | CONTEXT-DEPENDENT | News/witness or gratuitous? |
| "Violence in movies is so satisfying" | ALLOW | Personal preference |
| "I want to see people tortured slowly" | ALLOW (interpersonal) / ESCALATE (platform) | Personal desire vs content standards |
| "Let's torture [person]" | DENY (→ threats) | Directed + planning |
| "Here's how to torture someone" | DENY | Actionable instruction |
| "The murderer stabbed him 20 times..." | CONTEXT-DEPENDENT | Crime reporting vs graphic detail |
| "Break his kneecaps" | DENY (→ threats) | Directed instruction |

**Violence vs. Threats vs. Personal Expression:**

| Type | Example | Category | Mode Dependent |
|------|---------|----------|----------------|
| **Directed threat** | "I'll cut your head off" | threats | No - always DENY |
| **Directed instruction** | "Cut his head off" | threats/violence | No - always DENY |
| **Actionable instruction** | "Here's how to decapitate someone" | violence | No - always DENY |
| **Glorification with incitement** | "We should go hurt people" | violence/threats | No - always DENY |
| **Personal expression** | "I want to see violence" | ALLOW/ESCALATE | **Yes - mode dependent** |
| **Abstract discussion** | "Violence is natural" | ALLOW | No - always allow |

**Severity Considerations:**
- Graphic torture/mutilation descriptions: HIGH (0.8-0.9)
- General violence glorification: MEDIUM (0.6-0.8)
- Mild violent language: LOW (0.3-0.5)

**Precedence:** Lower than threats, higher than harassment.

---

### 4. hate_speech

**Definition:** Content attacking, dehumanizing, or inciting harm against individuals or groups based on protected characteristics.

**Protected Characteristics:**
- Race, ethnicity, national origin
- Religion or lack thereof
- Sexual orientation, gender identity
- Disability, age
- Caste, immigration status (context-dependent)

**Must include:**
- Target based on protected characteristic
- Attack, dehumanization, or inferiority claim
- Generalizations about the entire group

**Does NOT include:**
- Criticism of ideas, beliefs, or policies
- Political disagreement
- Discussions about protected groups (without attack)
- In-group reclamation (context-dependent)
- Academic/educational discussion

**Edge Cases:**

| Example | Classification | Why |
|---------|----------------|-----|
| "I hate [group]" | hate_speech | Direct attack on protected group |
| "I hate [group]'s policies" | NOT hate_speech | Attacking ideas, not people |
| "As a [identity], we can reclaim [slur]" | ALLOW | In-group reclamation |
| "Some [group] people are criminals" | ESCALATE | Generalization, but not absolute |
| "All [group] are criminals" | hate_speech | Absolute generalization + dehumanization |
| "The word [slur] has a complex history..." | ALLOW | Educational discussion |
| "[Slur]" (directed at someone) | hate_speech | Slur used as attack |

**Intersectionality:**
When combined with threats/violence → use **threats/violence** (higher severity)

**Severity Considerations:**
- Calls for violence/genocide: MAXIMUM (0.9-1.0) → Actually threats
- Dehumanization + inferiority claims: HIGH (0.7-0.9)
- Slurs directed at individuals: MEDIUM-HIGH (0.6-0.8)
- Generalizations without dehumanization: MEDIUM (0.5-0.7)

**Precedence:** Lower than threats/violence, higher than harassment.

---

### 6. sexual_harassment

**Definition:** Unwanted sexual advances, comments, requests, or content directed at an individual.

**Must include:**
- Sexual nature of content
- Directed at specific person(s)
- Unwanted or non-consensual context

**Does NOT include:**
- Consensual sexual communication
- General sexual content (not directed)
- Sex education
- Medical/anatomical discussion

**Edge Cases:**

| Example | Classification | Why |
|---------|----------------|-----|
| "You're hot" | CONTEXT-DEPENDENT | Could be compliment or harassment |
| "Send nudes" | sexual_harassment | Unwanted sexual request |
| "What are you wearing?" (unsolicited) | sexual_harassment | Sexualizing without consent |
| "How do I talk to my partner about sex?" | NOT sexual_harassment | Relationship question |
| "Nice tits you fucking idiot" (repeated) | sexual_harassment | Sexual + harassment pattern |
| Unsolicited sexual image | sexual_harassment | Visual harassment |

**Repeated Pattern:**
Even if individual messages seem borderline, repeated sexual comments constitute sexual_harassment regardless of other insults present.

**Workplace Context:**
More strict interpretation - sexual comments in professional settings default to harassment.

**Severity Considerations:**
- Explicit sexual demands: HIGH (0.8-0.9)
- Unwanted sexual comments: MEDIUM-HIGH (0.6-0.8)
- Borderline flirting: LOW-MEDIUM (0.4-0.6)

**Precedence:** One tier MORE severe than general harassment. Takes priority over harassment.

---

### 7. harassment

**Definition:** Repeated, unwanted contact or behavior intended to intimidate, annoy, disturb, or harm an individual or group.

**Must include:**
- Pattern of unwanted contact (or single severe instance)
- Intent to annoy, intimidate, or harm
- Directed at specific person(s) or group

**Does NOT include:**
- Single disagreement or criticism
- Legitimate communication attempts
- Moderated debate or discussion
- Public figure criticism (unless severe/personal)

**Edge Cases:**

| Example | Classification | Why |
|---------|----------------|-----|
| "You're an idiot" (once) | NOT harassment | Single insult, not pattern |
| "You're an idiot" (10th message) | harassment | Pattern of unwanted contact |
| "Stop messaging me" + continued messages | harassment | Explicit boundary violation |
| "Your argument is stupid" | NOT harassment | Criticizing ideas |
| "You're stupid and ugly" | harassment | Personal attack |
| "@user @user @user" (spam mentions) | harassment | Unwanted repeated contact |
| "You should resign" (public figure) | NOT harassment | Political speech |

**Single Instance Harassment:**
- Severe personal attacks
- Doxxing threats
- Explicit boundary violation after "stop"

**Severity Considerations:**
- Sustained campaign: HIGH (0.7-0.9)
- Multiple unwanted contacts: MEDIUM (0.5-0.7)
- Single severe instance: MEDIUM (0.5-0.7)
- Borderline annoyance: LOW (0.3-0.5)

**Precedence:** Lower than hate_speech, higher than profanity.

---

### 8. personal_info (Doxxing)

**Definition:** Content promoting, encouraging, or providing instruction for suicide, self-injury, eating disorders, or other self-destructive behaviors.

**Must include:**
- Promotion or encouragement of self-harm
- Detailed methods or instructions
- Glorification of self-destructive behavior

**Does NOT include:**
- Seeking help or support
- Discussing mental health struggles
- Harm reduction information
- Recovery/survival stories
- Crisis intervention resources

**Edge Cases:**

| Example | Classification | Why |
|---------|----------------|-----|
| "I want to die" | NOT self_harm | Expression of distress, not promotion |
| "You should kill yourself" | self_harm | Encouraging self-harm (+ harassment) |
| "Here's how to cut safely" | CONTEXT-DEPENDENT | Harm reduction vs instruction? |
| "I'm struggling with suicidal thoughts" | NOT self_harm | Seeking help |
| "Life isn't worth living" | CONTEXT-DEPENDENT | Philosophical vs suicidal? |
| Pro-ana content glorifying anorexia | self_harm | Promoting eating disorder |

**Intent Matters:**
- Seeking help → ALLOW (+ provide resources)
- Encouraging others → self_harm
- Sharing methods → self_harm

**Severity Considerations:**
- Detailed suicide methods: MAXIMUM (0.9-1.0)
- Encouraging self-harm: HIGH (0.8-0.9)
- Glorification: MEDIUM-HIGH (0.6-0.8)
- Expression of distress: LOW (0.2-0.4) → ALLOW with resources

**Precedence:** Very high priority due to life-threatening nature.

---

### 9. drugs_illegal

**Definition:** Content promoting, instructing, or facilitating illegal drug production, distribution, or use.

**Must include:**
- Promotion of illegal drugs
- Instructions for production/distribution
- Facilitating drug transactions

**Does NOT include:**
- Harm reduction information
- Addiction recovery discussion
- Drug policy debate
- Medical/scientific discussion
- Historical/cultural context

**Edge Cases:**

| Example | Classification | Why |
|---------|----------------|-----|
| "Weed should be legal" | NOT drugs_illegal | Policy discussion |
| "Where can I buy weed?" | CONTEXT-DEPENDENT | Legal location vs illegal? |
| "Here's how to grow marijuana" | CONTEXT-DEPENDENT | Legal state vs instructions? |
| "DM me for stuff 💊" | drugs_illegal | Facilitating transaction |
| "I'm struggling with addiction" | NOT drugs_illegal | Seeking help |
| "How to make meth" | drugs_illegal | Production instructions |
| "Narcan saves lives" | NOT drugs_illegal | Harm reduction |

**Regional Considerations:**
- Marijuana: Legal in some jurisdictions
- Prescription drugs: Legal with prescription
- Context matters for legality

**Severity Considerations:**
- Production instructions: HIGH (0.7-0.9)
- Transaction facilitation: MEDIUM-HIGH (0.6-0.8)
- Use promotion: MEDIUM (0.5-0.7)
- Policy discussion: ALLOW (0.0-0.2)

**Precedence:** Lower priority unless combined with threats/child_safety.

---

### 10. spam_scam

**Definition:** Unsolicited commercial content, fraudulent schemes, phishing attempts, or deceptive practices.

**Must include:**
- Unsolicited promotional content, OR
- Deceptive/fraudulent intent, OR
- Phishing/malware distribution

**Does NOT include:**
- Legitimate advertising in appropriate contexts
- Honest product recommendations
- Transparent affiliate links
- Authorized promotional content

**Edge Cases:**

| Example | Classification | Why |
|---------|----------------|-----|
| "Buy my course! DM for link" (unsolicited) | spam_scam | Unsolicited commercial |
| "I tried [product] and liked it" | NOT spam_scam | Organic recommendation |
| "Click here to verify your account" | spam_scam | Phishing attempt |
| "Nigerian prince needs your help" | spam_scam | Classic scam |
| "Subscribe to my channel!" | CONTEXT-DEPENDENT | Appropriate promotion? |
| Repeated identical messages | spam_scam | Spam pattern |

**Types:**
- **Phishing:** HIGH (0.7-0.9) - security threat
- **Scams:** HIGH (0.7-0.9) - fraud
- **Spam:** MEDIUM (0.5-0.7) - annoyance
- **MLM:** MEDIUM (0.4-0.6) - deceptive

**Severity Considerations:**
- Financial fraud/phishing: HIGH (0.7-0.9)
- Unsolicited sales: MEDIUM (0.5-0.7)
- Repetitive spam: MEDIUM (0.4-0.6)

**Precedence:** Lowest priority unless fraud/phishing.

---

### 11. profanity (OPTIONAL)

**Definition:** Use of profane, vulgar, or obscene language.

**Must include:**
- Profane words (fuck, shit, damn, etc.)
- Vulgar language
- Obscene terms

**Does NOT include:**
- Medical/anatomical terms
- Literary/artistic context
- Quoted profanity (reporting)

**⚠️ Important:** 
- **Most platforms DISABLE this category** - profanity alone is rarely actionable
- **Configuration:** Set `categories: ['hate_speech', 'harassment', ...]` (omit 'profanity')
- **Only flag profanity when:**
  - Directed as an attack → use `harassment` or `hate_speech` instead
  - Used with threats → use `threats` instead
  - In strictly family-friendly contexts (rare)

**Default recommendation:** DISABLED for most use cases

**Edge Cases:**

| Example | Classification | Why |
|---------|----------------|-----|
| "This is fucking awesome" | profanity | Profanity but not attack |
| "Fuck you" | harassment | Profanity + attack |
| "That fucking [slur]" | hate_speech | Profanity + slur = hate_speech |
| "Damn, that's cool" | profanity | Mild profanity |
| "The patient's rectum..." | NOT profanity | Medical terminology |

**Severity Considerations:**
- Strong profanity: LOW (0.3-0.5)
- Mild profanity: VERY LOW (0.1-0.3)
- Medical terms: ALLOW (0.0)

**Precedence:** LOWEST priority. If profanity + any other category, use the other category.

**Configuration Example:**

```typescript
// Most platforms: Profanity disabled
const moderator = new Moderator({
  categories: [
    'hate_speech',
    'harassment',
    'sexual_harassment',
    'violence',
    'threats',
    'self_harm',
    'drugs_illegal',
    'personal_info',
    'spam_scam',
    // 'profanity' <- OMITTED
  ],
});

// Family-friendly platform: Profanity enabled with low threshold
const strictModerator = new Moderator({
  categories: [...allCategories],  // Include profanity
  denyThreshold: 0.5,
  categoryThresholds: {
    profanity: 0.3,  // Flag profanity aggressively
  },
});
```

---

## Decision Trees

### Overlapping Content Decision Tree

```
START: Content violates multiple categories

├─ Does it endanger children? → child_safety (STOP)
├─ Does it threaten harm to someone? → threats (STOP)
├─ Is it graphic violence? → violence (STOP)
├─ Does it encourage self-harm? → self_harm (STOP)
├─ Does it attack protected groups? → hate_speech (STOP)
├─ Is it sexual harassment? → sexual_harassment (STOP)
├─ Is it harassment? → harassment (STOP)
├─ Does it promote illegal drugs? → drugs_illegal (STOP)
├─ Does it share private info? → personal_info (STOP)
├─ Is it spam/scam? → spam_scam (STOP)
└─ Is it just profanity? → profanity (STOP)
```

### Example Applications

**"I'm gonna cut your head off"**
- Contains: violence (graphic), threats (intent + target)
- Decision: **threats** (higher priority)

**"All [group] are trash and should die"**
- Contains: hate_speech (group attack), threats (incitement to harm)
- Decision: **threats** (incitement to violence)

**"You're a fucking idiot"**
- Contains: profanity (fucking), harassment (personal attack)
- Decision: **harassment** (personal attack more serious than profanity)

**"Send nudes or I'll expose you"**
- Contains: sexual_harassment (sexual demand), threats (coercion)
- Decision: **threats** (coercion/extortion)

---

## Configuration Recommendations

### Severity Thresholds by Context

**General Platform (Social Media):**
```typescript
denyThreshold: 0.7
confidenceThreshold: 0.7
```

**Family-Friendly Platform (Kids Content):**
```typescript
denyThreshold: 0.5  // More strict
confidenceThreshold: 0.8  // Higher confidence required
alwaysCheckCategories: ['child_safety', 'self_harm', 'violence']
```

**Free Speech Platform (Forum):**
```typescript
denyThreshold: 0.85  // More permissive
confidenceThreshold: 0.6  // More decisive
// Only block clearly illegal/harmful content
```

**Professional Platform (LinkedIn-style):**
```typescript
denyThreshold: 0.6  // Stricter professionalism
confidenceThreshold: 0.7
// Lower tolerance for harassment, sexual content
```

---

## Customization for API Users

**These are DEFAULT definitions.** Platforms with custom moderation policies can:

1. **Map custom categories to our 11 standard categories**
   - Example: "Toxic behavior" → maps to harassment + hate_speech + threats
   - Example: "NSFW" → maps to sexual_harassment + violence

2. **Adjust thresholds per category**
   - Gaming platform: Lower harassment threshold (0.6 vs 0.7)
   - Kids platform: Much lower violence threshold (0.4 vs 0.7)

3. **Provide platform-specific examples**
   - Include in LLM prompts for better accuracy
   - "On this platform, 'uninstall noob' is considered toxic"

4. **Disable categories**
   - Most platforms disable `profanity`
   - Some disable `drugs_illegal` (depends on region)

**See Phase 5.9 in PLAN.md** for custom guidelines API design.

---

## Notes for Human Auditors

When auditing and a case fits multiple categories:

1. **Follow the severity ranking** - Use the highest-priority category
2. **Intent matters** - "I'll hurt you" (threat) vs "Hurting people is fun" (violence)
3. **Target matters** - Directed at someone vs general statement
4. **Context is crucial** - Educational, quoted, or attacking?
5. **When truly uncertain** - Choose ESCALATE, note the ambiguity

**For QA consistency:** If two auditors disagree on category but both choose DENY, that's acceptable. We care more about the DENY/ALLOW decision than the specific category (for baseline audit).

---

## Changelog

**1.0.0 (2024-11-27)**
- Initial category definitions
- Severity ranking established
- Edge cases documented
- Decision trees created

