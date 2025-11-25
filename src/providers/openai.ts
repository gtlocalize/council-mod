/**
 * OpenAI Moderation Provider
 * 
 * Uses OpenAI's free Moderation API endpoint.
 * - Free (doesn't count toward usage)
 * - Fast, purpose-built for content moderation
 * - Good category coverage
 */

import { ModerationProvider, ProviderResult, ProviderConfig, ProviderInfo } from './types';
import { CategoryScores } from '../types';

interface OpenAIModerationResponse {
  id: string;
  model: string;
  results: Array<{
    flagged: boolean;
    categories: Record<string, boolean>;
    category_scores: Record<string, number>;
  }>;
}

export class OpenAIProvider implements ModerationProvider {
  readonly name = 'openai';
  readonly displayName = 'OpenAI Moderation';
  readonly requiresApiKey = true;
  
  private apiKey: string | undefined;
  private endpoint: string;
  private timeout: number;
  
  constructor(config: ProviderConfig = {}) {
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    this.endpoint = config.endpoint || 'https://api.openai.com/v1/moderations';
    this.timeout = config.timeout || 10000;
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
      categories: [
        'hate_speech', 'harassment', 'sexual_harassment', 
        'violence', 'self_harm', 'child_safety', 'threats'
      ],
      rateLimit: {
        requestsPerMinute: 1000,  // Very generous
      },
      pricing: {
        model: 'free',
        details: 'Free for all OpenAI API users',
      },
    };
  }
  
  async analyze(text: string): Promise<ProviderResult> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }
    
    const startTime = performance.now();
    
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: text,
        model: 'omni-moderation-latest',
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }
    
    const data: OpenAIModerationResponse = await response.json();
    const result = data.results[0];
    const latencyMs = performance.now() - startTime;
    
    // Map OpenAI categories to our categories
    const categories = this.mapCategories(result.category_scores);
    
    // Calculate overall confidence as max category score
    const confidence = Math.max(...Object.values(result.category_scores));
    
    return {
      provider: this.name,
      flagged: result.flagged,
      confidence,
      categories,
      rawResponse: data,
      latencyMs,
    };
  }
  
  private mapCategories(scores: Record<string, number>): CategoryScores {
    return {
      hate_speech: Math.max(scores['hate'] || 0, scores['hate/threatening'] || 0),
      harassment: scores['harassment'] || 0,
      sexual_harassment: scores['sexual'] || 0,
      violence: Math.max(scores['violence'] || 0, scores['violence/graphic'] || 0),
      threats: Math.max(scores['harassment/threatening'] || 0, scores['hate/threatening'] || 0),
      self_harm: Math.max(
        scores['self-harm'] || 0,
        scores['self-harm/intent'] || 0,
        scores['self-harm/instructions'] || 0
      ),
      drugs_illegal: scores['illicit'] || 0,
      child_safety: scores['sexual/minors'] || 0,
    };
  }
}

