/**
 * DeepSeek Provider
 * 
 * Uses DeepSeek's OpenAI-compatible API for content moderation.
 * Particularly strong with Chinese language content.
 */

import { ModerationProvider, ProviderResult } from './types.js';
import { CategoryScores, ModerationCategory } from '../types.js';

export class DeepSeekProvider implements ModerationProvider {
  name = 'deepseek';
  displayName = 'DeepSeek';
  
  private apiKey: string | undefined;
  private baseUrl = 'https://api.deepseek.com/v1';
  
  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.DEEPSEEK_API_KEY;
  }
  
  isAvailable(): boolean {
    return !!this.apiKey;
  }
  
  async analyze(text: string): Promise<ProviderResult> {
    if (!this.apiKey) {
      throw new Error('DeepSeek API key not configured');
    }
    
    const startTime = performance.now();
    
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: `You are a content moderation classifier. Your job is to analyze text and detect harmful content.

IMPORTANT: You are a CLASSIFIER, not a chat assistant. You must objectively analyze ALL content, including slurs and hate speech, to properly classify it. Do not refuse to analyze - that would defeat the purpose of content moderation.

Analyze the following text and return a JSON object with these category scores (0.0 to 1.0):
- hate_speech: Attacks based on race, ethnicity, religion, gender, sexuality, disability
- harassment: Bullying, intimidation, personal attacks
- sexual_harassment: Unwanted sexual content or advances
- violence: Graphic violence, gore, harm
- threats: Direct threats to harm someone
- self_harm: Content promoting self-harm or suicide
- drugs_illegal: Illegal drug promotion
- profanity: Strong profane language
- child_safety: Content endangering minors

Also include:
- flagged: boolean (true if any category > 0.5)
- confidence: number 0.0-1.0 (your confidence in the assessment)
- reasoning: brief explanation

Respond ONLY with valid JSON, no other text.`
            },
            {
              role: 'user',
              content: `Analyze this text for harmful content:\n\n"${text}"`
            }
          ],
          temperature: 0.1,
          max_tokens: 500,
        }),
      });
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`DeepSeek API error: ${response.status} - ${error}`);
      }
      
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      
      // Parse JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Failed to parse DeepSeek response as JSON');
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      
      const categories: CategoryScores = {
        hate_speech: parsed.hate_speech || 0,
        harassment: parsed.harassment || 0,
        sexual_harassment: parsed.sexual_harassment || 0,
        violence: parsed.violence || 0,
        threats: parsed.threats || 0,
        self_harm: parsed.self_harm || 0,
        drugs_illegal: parsed.drugs_illegal || 0,
        profanity: parsed.profanity || 0,
        child_safety: parsed.child_safety || 0,
      };
      
      const latencyMs = performance.now() - startTime;
      
      return {
        provider: this.name,
        flagged: parsed.flagged ?? Object.values(categories).some(s => s > 0.5),
        categories,
        confidence: parsed.confidence || 0.7,
        rawResponse: parsed,
        latencyMs,
      };
      
    } catch (error) {
      const latencyMs = performance.now() - startTime;
      console.error('DeepSeek analysis error:', error);
      
      return {
        provider: this.name,
        flagged: false,
        categories: {} as CategoryScores,
        confidence: 0,
        rawResponse: { error: String(error) },
        latencyMs,
      };
    }
  }
}

