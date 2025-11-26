/**
 * Test Setup Helper
 * 
 * Shared setup for tests.
 */

import 'dotenv/config';

// Increase timeout for API calls
export const API_TIMEOUT = 30000;

// Check if API is available
export function hasApiKey(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

// Skip message for tests requiring API
export function skipIfNoApi(): void {
  if (!hasApiKey()) {
    console.log('  ⚠️  Skipping API tests (OPENAI_API_KEY not set)');
  }
}

