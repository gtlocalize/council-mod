/**
 * Google Providers
 * 
 * 1. Perspective API - Free tier, toxicity focused
 * 2. Gemini - Paid, general purpose LLM
 */

import { ModerationProvider, ProviderResult, ProviderConfig, ProviderInfo } from './types';
import { CategoryScores, MODERATION_CATEGORIES } from '../types';

// =============================================================================
// PERSPECTIVE API PROVIDER
// =============================================================================

interface PerspectiveResponse {
  attributeScores: Record<string, {
    summaryScore: { value: number };
  }>;
}

export class PerspectiveProvider implements ModerationProvider {
  readonly name = 'perspective';
  readonly displayName = 'Google Perspective API';
  readonly requiresApiKey = true;
  
  private apiKey: string | undefined;
  private endpoint: string;
  
  constructor(config: ProviderConfig = {}) {
    this.apiKey = config.apiKey || process.env.PERSPECTIVE_API_KEY;
    this.endpoint = 'https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze';
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
      categories: ['hate_speech', 'harassment', 'threats', 'profanity', 'sexual_harassment'],
      rateLimit: {
        requestsPerMinute: 60,
        requestsPerDay: 10000,
      },
      pricing: {
        model: 'free',
        details: 'Free tier with rate limits',
      },
    };
  }
  
  async analyze(text: string): Promise<ProviderResult> {
    if (!this.apiKey) {
      throw new Error('Perspective API key not configured');
    }
    
    const startTime = performance.now();
    
    const response = await fetch(`${this.endpoint}?key=${this.apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        comment: { text },
        languages: ['en'],
        requestedAttributes: {
          TOXICITY: {},
          SEVERE_TOXICITY: {},
          IDENTITY_ATTACK: {},
          INSULT: {},
          PROFANITY: {},
          THREAT: {},
          SEXUALLY_EXPLICIT: {},
        },
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Perspective API error: ${response.status} - ${error}`);
    }
    
    const data: PerspectiveResponse = await response.json();
    const latencyMs = performance.now() - startTime;
    
    const categories = this.mapCategories(data.attributeScores);
    const maxScore = Math.max(...Object.values(categories).filter((v): v is number => v !== undefined));
    
    return {
      provider: this.name,
      flagged: maxScore > 0.7,
      confidence: maxScore,
      categories,
      rawResponse: data,
      latencyMs,
    };
  }
  
  private mapCategories(scores: PerspectiveResponse['attributeScores']): CategoryScores {
    const getValue = (key: string) => scores[key]?.summaryScore?.value || 0;
    
    return {
      hate_speech: getValue('IDENTITY_ATTACK'),
      harassment: Math.max(getValue('TOXICITY'), getValue('INSULT')),
      threats: getValue('THREAT'),
      profanity: getValue('PROFANITY'),
      sexual_harassment: getValue('SEXUALLY_EXPLICIT'),
      violence: getValue('SEVERE_TOXICITY'),
    };
  }
}

// =============================================================================
// GEMINI PROVIDER
// =============================================================================

const GEMINI_MODERATION_PROMPT = `You are a content moderation classifier for a trust & safety system. Your role is to ANALYZE and CLASSIFY text to help platforms identify potentially harmful content.

IMPORTANT: You are examining content submitted for moderation review. You MUST analyze and score the content objectively, even if it contains slurs, threats, or offensive language. This is necessary for content moderation to function.

## Categories to score (0.0-1.0):
- hate_speech: Attacks based on protected characteristics
- harassment: Bullying, intimidation directed at individuals
- violence: Graphic violence, threats of physical harm
- threats: Direct threats to harm someone
- profanity: Strong profane language
- sexual_harassment: Unwanted sexual content
- self_harm: Content promoting self-harm or suicide
- drugs_illegal: Promotion of illegal activities

## Context matters:
- ATTACK (intent to harm) vs DISCUSSION (talking about)
- QUOTE (reporting speech) vs EDUCATIONAL (academic)
- RECLAMATION (in-group use of reclaimed terms)

Text to analyze: """{TEXT}"""

Respond with ONLY this JSON:
{"flagged": bool, "confidence": 0.0-1.0, "categories": {"category": score}, "reasoning": "brief"}`;

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
    };
  }>;
}

export class GeminiProvider implements ModerationProvider {
  readonly name = 'gemini';
  readonly displayName = 'Google Gemini';
  readonly requiresApiKey = true;
  
  private apiKey: string | undefined;
  private model: string;
  
  constructor(config: ProviderConfig & { model?: string } = {}) {
    this.apiKey = config.apiKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    // Use gemini-2.0-flash-exp (newer) or gemini-pro (stable fallback)
    this.model = config.model || 'gemini-2.0-flash-exp';
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
        requestsPerMinute: 60,
      },
      pricing: {
        model: 'pay-per-request',
        details: 'Flash: $0.075/M input, $0.30/M output tokens',
      },
    };
  }
  
  async analyze(text: string): Promise<ProviderResult> {
    if (!this.apiKey) {
      throw new Error('Google API key not configured');
    }
    
    const startTime = performance.now();
    const prompt = GEMINI_MODERATION_PROMPT.replace('{TEXT}', text);
    
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1024,
          },
        }),
      }
    );
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${error}`);
    }
    
    const data: GeminiResponse = await response.json();
    const latencyMs = performance.now() - startTime;
    
    try {
      const textContent = data.candidates[0]?.content?.parts[0]?.text || '';
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
      console.error('Failed to parse Gemini response:', parseError);
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
      const normalizedKey = key.toLowerCase().replace(/[- ]/g, '_');
      if (MODERATION_CATEGORIES.includes(normalizedKey as any)) {
        result[normalizedKey as keyof CategoryScores] = Math.min(Math.max(value, 0), 1);
      }
    }
    return result;
  }
}

