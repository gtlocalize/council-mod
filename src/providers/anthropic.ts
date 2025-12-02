/**
 * Anthropic Claude Provider
 * 
 * Uses Claude for nuanced content moderation.
 * - Constitutional AI, tends toward caution
 * - Good at understanding context and nuance
 * - Paid per token
 * 
 * PROMPT CACHING: Uses Anthropic's prompt caching to reduce costs by ~90%
 * when enabled. The system prompt is cached and reused across requests.
 */

import { ModerationProvider, ProviderResult, ProviderConfig, ProviderInfo } from './types';
import { CategoryScores, MODERATION_CATEGORIES } from '../types';

/**
 * System prompt - cached when caching is enabled (~500 tokens)
 */
const SYSTEM_PROMPT = `You are a content moderation classifier for a trust & safety system. Your role is to ANALYZE and CLASSIFY text to help platforms identify potentially harmful content.

IMPORTANT: You are NOT the target of this content. You are a safety tool examining content that users have submitted to be checked. You MUST analyze the content objectively and provide classification scores, even if the content contains slurs, threats, or other harmful language. Refusing to analyze defeats the purpose of content moderation.

## Categories to evaluate (score 0.0-1.0):
- hate_speech: Attacks based on race, ethnicity, religion, gender, sexual orientation, disability
- harassment: Bullying, intimidation directed at individuals (NOT just "fuck you" alone)
- sexual_harassment: Unwanted sexual content or advances
- violence: Graphic violence, gore, instructions for harm
- threats: Direct OR implied threats to harm someone (includes "I know where you live")
- self_harm: Content promoting or glorifying self-harm or suicide
- drugs_illegal: Promotion of illegal drugs or activities
- profanity: Strong profane language (ALLOW by default unless combined with harassment)
- child_safety: Any content that could endanger minors
- personal_info: Doxxing, sharing private information
- spam_scam: Spam, scams, phishing attempts

## Context matters - consider:
- Is this an ATTACK (directed at someone with intent to harm)?
- Is this a DISCUSSION (talking about a topic)?
- Is this a QUOTE (reporting what someone else said)?
- Is this EDUCATIONAL (academic/documentary context)?
- Is this RECLAMATION (in-group use of reclaimed terms)?

Respond ONLY with JSON (no other text):
{
  "flagged": true/false,
  "confidence": 0.0-1.0,
  "categories": { "category_name": 0.0-1.0 },
  "reasoning": "Brief explanation"
}`;

interface ClaudeResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface AnthropicConfig extends ProviderConfig {
  model?: string;
  enableCaching?: boolean;
}

export class AnthropicProvider implements ModerationProvider {
  readonly name = 'anthropic';
  readonly displayName = 'Anthropic Claude';
  readonly requiresApiKey = true;
  
  private apiKey: string | undefined;
  private endpoint: string;
  private model: string;
  private timeout: number;
  private enableCaching: boolean;
  
  // Cache statistics for cost tracking
  private cacheStats = {
    totalRequests: 0,
    cacheHits: 0,
    cacheCreations: 0,
    inputTokens: 0,
    cachedTokens: 0,
  };
  
  constructor(config: AnthropicConfig = {}) {
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    this.endpoint = config.endpoint || 'https://api.anthropic.com/v1/messages';
    this.model = config.model || 'claude-3-haiku-20240307'; // Fast + cheap
    this.timeout = config.timeout || 30000;
    this.enableCaching = config.enableCaching ?? true; // Enable by default
  }
  
  /**
   * Get cache statistics for cost visibility
   */
  getCacheStats() {
    const savings = this.cacheStats.cachedTokens > 0
      ? ((this.cacheStats.cachedTokens / (this.cacheStats.inputTokens + this.cacheStats.cachedTokens)) * 100).toFixed(1)
      : '0';
    
    return {
      ...this.cacheStats,
      savingsPercent: savings,
    };
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
    this.cacheStats.totalRequests++;
    
    // Build headers - add caching beta header if enabled
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
    };
    
    if (this.enableCaching) {
      headers['anthropic-beta'] = 'prompt-caching-2024-07-31';
    }
    
    // Build request body with system/user message separation
    const requestBody: Record<string, unknown> = {
      model: this.model,
      max_tokens: 1024,
      messages: [
        { 
          role: 'user', 
          content: `Text to analyze:\n"""\n${text}\n"""` 
        }
      ],
    };
    
    // Add system prompt with caching if enabled
    if (this.enableCaching) {
      requestBody.system = [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ];
    } else {
      requestBody.system = SYSTEM_PROMPT;
    }
    
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }
    
    const data: ClaudeResponse = await response.json();
    const latencyMs = performance.now() - startTime;
    
    // Track cache statistics
    if (data.usage) {
      this.cacheStats.inputTokens += data.usage.input_tokens;
      if (data.usage.cache_creation_input_tokens) {
        this.cacheStats.cacheCreations++;
        this.cacheStats.cachedTokens += data.usage.cache_creation_input_tokens;
      }
      if (data.usage.cache_read_input_tokens) {
        this.cacheStats.cacheHits++;
        this.cacheStats.cachedTokens += data.usage.cache_read_input_tokens;
      }
    }
    
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

