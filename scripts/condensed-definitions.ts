/**
 * Condensed Category Definitions for LLM Prompts
 * 
 * User-first safety approach - ~850 tokens
 * Optimized for inclusion in audit prompts without overwhelming context window
 */

export const CONDENSED_CATEGORY_DEFINITIONS = `
MODERATION POLICY - User-First Safety Approach

═══════════════════════════════════════════════════════════════
CORE FRAMEWORK
═══════════════════════════════════════════════════════════════

CONFESSIONS vs THREATS vs INSTRUCTIONS:
✓ Confession (past): "I killed someone"               → ALLOW*
✗ Threat (future): "I will kill you"                  → DENY (threats)
✗ Ideation: "I fantasize about mass shooting"         → DENY (violence)
✗ Instruction: "Here's how to kill someone"           → DENY (violence)
*Exception: child_safety confessions always DENY

PERSONAL EXPRESSION vs DIRECTED HARM:
✓ Personal: "I want to see violence"                  → ALLOW
✗ Directed: "You should experience violence"          → DENY

PROFANITY vs HARASSMENT:
✓ "Fuck you" (alone)                                  → ALLOW (profanity)
✗ "Fuck you, you ugly idiot"                          → DENY (harassment)
✗ "Fuck you" (repeated after "stop")                  → DENY (harassment pattern)

CRITICAL: Profanity = aggressive language WITHOUT personal attacks or pattern
         Harassment = profanity + personal attributes OR sustained pattern

EXPLICIT vs IMPLIED THREATS:
✗ "I will kill you"                                   → DENY (threats)
✗ "I know where you live. Nice house."                → DENY (threats)
✗ "Saw your kid at school today"                      → DENY (threats)

CRITICAL: Implied threats are THREATS (not harassment). Users experience 
          these as equally or MORE dangerous than explicit threats.

═══════════════════════════════════════════════════════════════
CATEGORIES (by severity)
═══════════════════════════════════════════════════════════════

1. child_safety (ALWAYS DENY, even confessions)
   - Sexual/exploitative content involving minors
   - Grooming behavior or attempts
   - Zero tolerance, no exceptions

2. threats (includes explicit AND implied)
   - Intent to harm (physical, emotional, material)
   - Examples:
     ✗ "I will kill you" (explicit)
     ✗ "I know where you live. Nice house." (implied surveillance)
     ✗ "Accidents happen. Drive safe." (veiled menace)
     ✗ "I'll be at [local landmark] tonight" (implied stalking)
     ✗ "Saw your kid at soccer practice" (surveillance reference)
     ✓ "I got into a fight yesterday" (confession, past tense)
   
   USER SAFETY: Implied threats show surveillance + calculated behavior.
                Often MORE concerning than explicit threats to victims.

3. violence
   - Graphic descriptions, gore, instructions, ideation
   - Examples:
     ✗ "Here's how to hurt someone" (instruction)
     ✗ "I fantasize about office shooting" (ideation, NOT confession)
     ✗ "Let's go hurt [person]" (incitement)
     ✓ "I was in a fight" (confession)
     ✓ "Violence in movies is great" (opinion about fiction)
   - NOT threats (threats are about intent toward specific person)

4. self_harm
   - Promoting/instructing self-harm or suicide
   - Examples:
     ✗ "You should kill yourself"
     ✗ "Here's how to cut safely" (method instruction)
     ✓ "I'm struggling with suicidal thoughts" (seeking help)

5. hate_speech
   - Attacks/denigration based on protected characteristics
   - Includes slurs, stereotyping, coded language, dog whistles
   - Examples:
     ✗ "[slur]" directed at someone
     ✗ "Women are intellectually inferior to men" (stereotyping)
     ✗ "Those people" (coded language in bigoted context)
     ✗ "Crime stats don't lie about [group]" (racist dog whistle)
     ✓ "The word '[slur]' has been reclaimed by..." (educational)
     ? "As a [identity], I reclaim [slur]" → ESCALATE if uncertain

6. sexual_harassment
   - Unwanted sexual content directed at someone
   - Examples:
     ✗ "Send nudes"
     ✗ "Nice tits" (unsolicited, to a person)
     ✓ "How do I talk to my partner about sex?" (advice seeking)

7. harassment
   - Sustained pattern OR severe personal attacks
   - Requires: attacks on personal attributes (intelligence, appearance, 
     worth) OR pattern after boundaries
   - Examples:
     ✗ "You're an ugly worthless idiot" (severe personal attack)
     ✗ "You're an idiot" (10th message after "stop") (pattern)
     ✗ "Fuck you, you stupid piece of shit" (profanity + personal attack)
     ✓ "You're wrong about this" (disagreement)
     ✓ "Fuck you" (profanity alone, no personal attack)
   
   CRITICAL: "Fuck you" alone = profanity (ALLOW by default)
             "Fuck you" + personal attributes = harassment (DENY)
             Single "you're an idiot" = NOT harassment
             Pattern or personal attributes = harassment

8. personal_info (doxxing)
   - Sharing private info without consent
   - Examples:
     ✗ "Here's their address: 123 Main St"
     ✗ "His real name is John Smith, phone: ..."
     ✓ "The company's office is at [public address]"

9. drugs_illegal
   - Promoting illegal drug sales/production
   - Examples:
     ✗ "DM me for pills 💊" (facilitating transaction)
     ✗ "How to make meth" (production instructions)
     ✓ "Weed should be legal" (policy discussion)
     ✓ "Narcan saves lives" (harm reduction)

10. spam_scam
    - Fraud, scams, phishing, unsolicited commercial
    - Examples:
      ✗ "Click to verify account" (phishing)
      ✗ "Nigerian prince" (scam)
      ✓ "I liked this product" (organic recommendation)

11. profanity (ALLOW by default, configurable)
    - Strong language WITHOUT personal attacks or pattern
    - Examples:
      ✓ "This is fucking awesome"
      ✓ "Fuck you" (alone, once)
      ✓ "Holy shit!"
      ✓ "Go fuck yourself" (generic, no personal attack)
    - Only DENY in family-friendly mode or if combined with harassment

═══════════════════════════════════════════════════════════════
EDGE CASES → ESCALATE
═══════════════════════════════════════════════════════════════

Escalate to human review when:
- Reclaimed language (uncertain about in-group status)
- Educational/academic discussion of sensitive topics
- Quoted speech (reporting what someone else said)
- Cultural context you're uncertain about
- Ambiguous intent (could be joking vs. serious)

═══════════════════════════════════════════════════════════════
DECISION CHECKLIST
═══════════════════════════════════════════════════════════════

1. Is it child_safety? → DENY (always, including confessions)
2. Is it a confession (past tense, NOT child_safety)? → ALLOW
3. Is it a threat (explicit OR implied)? → DENY (threats)
4. Is it an instruction for harm? → DENY (violence)
5. Is it profanity ALONE (no personal attack, no pattern)? → ALLOW
6. Does it attack personal attributes OR show harassment pattern? → DENY
7. Are you uncertain about context/intent? → ESCALATE
`;

export default CONDENSED_CATEGORY_DEFINITIONS;

