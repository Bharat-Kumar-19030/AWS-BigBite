/**
 * Gemini API Key Rotator
 * Cycles through multiple API keys in round-robin fashion.
 * Automatically retries with the next key on 429 Too Many Requests.
 *
 * NOTE: Keys are loaded lazily on first use so that dotenv has time to
 * populate process.env before this module reads it.
 */

let apiKeys = null;   // loaded on first use
let currentIndex = 0;

function getApiKeys() {
  if (apiKeys) return apiKeys;

  const keys = [];
  const placeholderPattern = /^your_.+_here$/i;

  // Always add the base key first
  const baseKey = process.env.GEMINI_API_KEY?.trim();
  if (baseKey && !placeholderPattern.test(baseKey)) keys.push(baseKey);

  // Add numbered keys (2, 3, 4, ... up to 20)
  for (let i = 2; i <= 20; i++) {
    const key = process.env[`GEMINI_API_KEY_${i}`]?.trim();
    if (key && !placeholderPattern.test(key)) keys.push(key);
  }

  if (keys.length === 0) throw new Error('No Gemini API keys configured in .env');

  // Log loaded keys (show only last 6 chars for security)
  const masked = keys.map((k, i) => `  Key ${i + 1}: ...${k.slice(-6)}`);
  console.log(`🔑 Gemini Key Rotator: Loaded ${keys.length} API key(s)\n${masked.join('\n')}`);
  apiKeys = keys;
  return apiKeys;
}

/**
 * Get the next API key in round-robin order.
 */
export function getNextApiKey() {
  const keys = getApiKeys();
  const key = keys[currentIndex];
  currentIndex = (currentIndex + 1) % keys.length;
  return key;
}

/**
 * Get current key without advancing the index.
 */
export function getCurrentApiKey() {
  return getApiKeys()[currentIndex];
}

/**
 * Total number of keys available.
 */
export function getKeyCount() {
  return getApiKeys().length;
}

/**
 * Wraps an async agent/LLM call with automatic key rotation on 429.
 * On 429, it tries the next key up to `maxRetries` times.
 */
//  * @param {(apiKey: string) => Promise<any>} fn - Async function that accepts an API key and returns a result
//  * @param {number} maxRetries - Max number of key rotations to attempt (defaults to total key count)
//  * @returns {Promise<any>}
export async function callWithRotation(fn, maxRetries) {
  const keys = getApiKeys();
  if (maxRetries === undefined) maxRetries = keys.length;
  let lastError;
  const tried = new Set();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const key = getNextApiKey();

    // Avoid retrying the same key twice in a row if we have alternatives
    if (tried.has(key) && tried.size < keys.length) continue;
    tried.add(key);

    try {
      return await fn(key);
    } catch (err) {
      const is429 =
        err?.status === 429 ||
        err?.statusText === 'Too Many Requests' ||
        err?.message?.includes('429') ||
        err?.message?.includes('Too Many Requests') ||
        err?.message?.includes('RESOURCE_EXHAUSTED');

      if (is429) {
        const keyShort = `...${key.slice(-6)}`;
        console.warn(`⚠️  Gemini 429 on key ${keyShort} (attempt ${attempt + 1}/${maxRetries + 1}). Rotating to next key...`);
        lastError = err;

        // Small backoff before retrying (300ms × attempt number)
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        }
        continue;
      }

      // Non-429 error — don't rotate, just rethrow
      throw err;
    }
  }

  // All keys exhausted
  console.error('❌ All Gemini API keys returned 429. Rate limit hit across all keys.');
  throw lastError;
}
