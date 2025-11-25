/**
 * Provider Registry
 * 
 * Central registry for all moderation providers.
 */

export * from './types';
export { OpenAIProvider } from './openai';
export { AnthropicProvider } from './anthropic';
export { PerspectiveProvider, GeminiProvider } from './google';
export { LocalProvider } from './local';
export type { LocalProviderResult } from './local';

import { ModerationProvider, ProviderConfig } from './types';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { PerspectiveProvider, GeminiProvider } from './google';
import { LocalProvider } from './local';

// =============================================================================
// PROVIDER REGISTRY
// =============================================================================

export type ProviderName = 'openai' | 'anthropic' | 'perspective' | 'gemini' | 'local';

const PROVIDER_CONSTRUCTORS: Record<ProviderName, new (config?: ProviderConfig) => ModerationProvider> = {
  openai: OpenAIProvider,
  anthropic: AnthropicProvider,
  perspective: PerspectiveProvider,
  gemini: GeminiProvider,
  local: LocalProvider,
};

/**
 * Create a provider instance by name
 */
export function createProvider(name: ProviderName, config?: ProviderConfig): ModerationProvider {
  const Constructor = PROVIDER_CONSTRUCTORS[name];
  if (!Constructor) {
    throw new Error(`Unknown provider: ${name}`);
  }
  return new Constructor(config);
}

/**
 * Get all available providers (those that are configured)
 */
export function getAvailableProviders(configs?: Partial<Record<ProviderName, ProviderConfig>>): ModerationProvider[] {
  const providers: ModerationProvider[] = [];
  
  for (const name of Object.keys(PROVIDER_CONSTRUCTORS) as ProviderName[]) {
    const provider = createProvider(name, configs?.[name]);
    if (provider.isAvailable()) {
      providers.push(provider);
    }
  }
  
  return providers;
}

/**
 * Get info about all providers
 */
export function getAllProviderInfo(configs?: Partial<Record<ProviderName, ProviderConfig>>) {
  return (Object.keys(PROVIDER_CONSTRUCTORS) as ProviderName[]).map(name => {
    const provider = createProvider(name, configs?.[name]);
    return provider.getInfo();
  });
}

