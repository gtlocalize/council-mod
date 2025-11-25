/**
 * Anthropic Claude Provider
 * 
 * Uses Claude for nuanced content moderation.
 * - Constitutional AI, tends toward caution
 * - Good at understanding context and nuance
 * - Paid per token
 */

import { ModerationProvider, ProviderResult, ProviderConfig, ProviderInfo } from './types';
import { CategoryScores, MODERATION_CATEGORIES } from '../types';

const MODERATION_PROMPT = `You are a content moderation classifier for a trust & safety system. Your role is to ANALYZE and CLASSIFY text to help platforms identify potentially harmful content.

IMPORTANT: You are NOT the target of this content. You are a safety tool examining content that users have submitted to be checked. You MUST analyze the content objectively and provide classification scores, even if the content contains slurs, threats, or other harmful language. Refusing to analyze defeats the purpose of content moderation.

The content below may contain offensive material. Your job is to classify it, not to refuse engagement.

## Categories to evaluate (score 0.0-1.0):
- hate_speech: Attacks based on race, ethnicity, religion, gender, sexual orientation, disability
- harassment: Bullying, threats, intimidation directed at individuals  
- sexual_harassment: Unwanted sexual content or advances
- violence: Graphic violence, gore, threats of physical harm
- threats: Direct threats to harm someone
- self_harm: Content promoting or glorifying self-harm or suicide
- drugs_illegal: Promotion of illegal drugs or activities
- profanity: Strong profane language
- child_safety: Any content that could endanger minors
- personal_info: Doxxing, sharing private information
- spam_scam: Spam, scams, phishing attempts

## Context matters - consider:
- Is this an ATTACK (directed at someone with intent to harm)?
- Is this a DISCUSSION (talking about a topic)?
- Is this a QUOTE (reporting what someone else said)?
- Is this EDUCATIONAL (academic/documentary context)?
- Is this RECLAMATION (in-group use of reclaimed terms)?

Respond ONLY with this JSON (no other text):
{
  "flagged": true/false,
  "confidence": 0.0-1.0,
  "categories": {
    "category_name": 0.0-1.0
  },
  "reasoning": "Brief explanation"
}

Text to analyze:
"""
{TEXT}
"""`;

interface ClaudeResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
}

export class AnthropicProvider implements ModerationProvider {
  readonly name = 'anthropic';
  readonly displayName = 'Anthropic Claude';
  readonly requiresApiKey = true;
  
  private apiKey: string | undefined;
  private endpoint: string;
  private model: string;
  private timeout: number;
  
  constructor(config: ProviderConfig & { model?: string } = {}) {
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    this.endpoint = config.endpoint || 'https://api.anthropic.com/v1/messages';
    this.model = config.model || 'claude-3-haiku-20240307'; // Fast + cheap
    this.timeout = config.timeout || 30000;
  }
  
  isAvailable(): boolean {
    return !!this.apiKey;
  }
  
  getInfo(): ProviderInfo {
    return {
      name: this.name,
      displayName: this.displayName,
      available: this.isAvailable(),
      requiresApiKey: true,
      categories: [...MODERATION_CATEGORIES],
      rateLimit: {
        requestsPerMinute: 50,
      },
      pricing: {
        model: 'pay-per-request',
        details: 'Haiku: $0.25/M input, $1.25/M output tokens',
      },
    };
  }
  
  async analyze(text: string): Promise<ProviderResult> {
    if (!this.apiKey) {
      throw new Error('Anthropic API key not configured');
    }
    
    const startTime = performance.now();
    
    const prompt = MODERATION_PROMPT.replace('{TEXT}', text);
    
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        messages: [
          { role: 'user', content: prompt }
        ],
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }
    
    const data: ClaudeResponse = await response.json();
    const latencyMs = performance.now() - startTime;
    
    // Parse Claude's JSON response
    const textContent = data.content.find(c => c.type === 'text')?.text || '';
    
    try {
      // Extract JSON from response (Claude sometimes adds explanation around it)
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      
      return {
        provider: this.name,
        flagged: parsed.flagged || false,
        confidence: parsed.confidence || 0.5,
        categories: this.normalizeCategories(parsed.categories || {}),
        rawResponse: { ...data, parsed },
        latencyMs,
      };
    } catch (parseError) {
      // If parsing fails, return a conservative result
      console.error('Failed to parse Claude response:', parseError);
      return {
        provider: this.name,
        flagged: false,
        confidence: 0.5,
        categories: {},
        rawResponse: data,
        latencyMs,
      };
    }
  }
  
  private normalizeCategories(categories: Record<string, number>): CategoryScores {
    const result: CategoryScores = {};
    for (const [key, value] of Object.entries(categories)) {
      // Normalize key to snake_case
      const normalizedKey = key.toLowerCase().replace(/[- ]/g, '_');
      if (MODERATION_CATEGORIES.includes(normalizedKey as any)) {
        result[normalizedKey as keyof CategoryScores] = Math.min(Math.max(value, 0), 1);
      }
    }
    return result;
  }
}

