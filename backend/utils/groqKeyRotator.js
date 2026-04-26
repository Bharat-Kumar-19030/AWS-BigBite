/**
 * Groq API Key Rotator
 * Cycles through multiple Groq API keys in round-robin fashion.
 * Automatically retries with the next key on 429 (rate-limit) or
 * tool_use_failed (400) errors, which are transient LLM failures.
 *
 * On 413 (request too large / token overflow), key rotation cannot help
 * because the problem is message size, not the key.  A special
 * GroqTokenOverflowError is thrown so the caller can clear the
 * conversation history checkpoint and retry with a fresh context.
 *
 * Keys are loaded lazily on first use so dotenv has time to populate
 * process.env before this module reads it.
 *
 * Env variable naming convention (must match .env):
 *   GROQ_API_KEY          ← key 1 (base)
 *   GROQ_API_KEY2         ← key 2
 *   GROQ_API_KEY3         ← key 3
 *   GROQ_API_KEY4 ...     ← etc, up to 20
 */

/**
 * Sentinel error thrown when the Groq request is too large (413).
 * The caller should clear the thread's MemorySaver checkpoint and retry.
 */
export class GroqTokenOverflowError extends Error {
  constructor(originalError) {
    super('Groq request too large — conversation history has been cleared. Please try again.');
    this.name = 'GroqTokenOverflowError';
    this.originalError = originalError;
  }
}

let groqApiKeys = null;   // loaded lazily on first use
let currentIndex = 0;

function getGroqApiKeys() {
  if (groqApiKeys) return groqApiKeys;

  const keys = [];
  const placeholderPattern = /^your_.+_here$/i;

  // Add the base key first
  const baseKey = process.env.GROQ_API_KEY?.trim();
  if (baseKey && !placeholderPattern.test(baseKey)) keys.push(baseKey);

  // Add numbered keys (2, 3, 4, ... up to 20)
  for (let i = 2; i <= 20; i++) {
    const key = process.env[`GROQ_API_KEY${i}`]?.trim();
    if (key && !placeholderPattern.test(key)) keys.push(key);
  }

  if (keys.length === 0) throw new Error('No Groq API keys configured in .env');

  // Log loaded keys (masked for security)
  const masked = keys.map((k, i) => `  Key ${i + 1}: ...${k.slice(-6)}`);
  console.log(`🔑 Groq Key Rotator: Loaded ${keys.length} API key(s)\n${masked.join('\n')}`);

  groqApiKeys = keys;
  return groqApiKeys;
}

/**
 * Get the next API key in round-robin order and advance the index.
 */
export function getNextGroqApiKey() {
  const keys = getGroqApiKeys();
  const key = keys[currentIndex];
  currentIndex = (currentIndex + 1) % keys.length;
  return key;
}

/**
 * Get the current API key without advancing the index.
 */
export function getCurrentGroqApiKey() {
  return getGroqApiKeys()[currentIndex];
}

/**
 * Total number of Groq keys available.
 */
export function getGroqKeyCount() {
  return getGroqApiKeys().length;
}

/**
 * Determine whether the request is too large (413 token overflow).
 * Rotating keys cannot help here — the caller must trim history instead.
 */
function isTokenOverflowError(err) {
  return (
    err?.status === 413 ||
    err?.message?.includes('413') ||
    (err?.error?.error?.type === 'tokens' &&
      err?.error?.error?.code === 'rate_limit_exceeded') ||
    err?.error?.error?.message?.includes('Request too large')
  );
}

/**
 * Determine whether an error from Groq/LangChain warrants a key rotation + retry.
 *
 * Rotatable conditions:
 *  - HTTP 429  → rate limit / quota exceeded
 *  - HTTP 400 with code "tool_use_failed" → transient LLM parsing failure
 *    (the model produced malformed JSON for a tool call; rotating the key
 *    resets the model's context and usually resolves it on retry)
 */
function isRotatableError(err) {
  // 429 — rate limit
  const is429 =
    err?.status === 429 ||
    err?.statusText === 'Too Many Requests' ||
    err?.message?.includes('429') ||
    err?.message?.includes('Too Many Requests') ||
    err?.message?.includes('RESOURCE_EXHAUSTED') ||
    (err?.error?.error?.message?.includes('rate_limit') &&
      err?.error?.error?.type !== 'tokens'); // exclude 413 token-overflow which has rate_limit_exceeded too

  // 400 tool_use_failed — transient LLM tool-call formatting error
  const isToolUseFailed =
    (err?.status === 400 || err?.message?.includes('400')) &&
    (err?.error?.error?.code === 'tool_use_failed' ||
     err?.message?.includes('tool_use_failed') ||
     err?.message?.includes('Failed to call a function'));

  return is429 || isToolUseFailed;
}

/**
 * Wraps an async agent/LLM factory with automatic key rotation.
 *
 * @param {(apiKey: string) => Promise<any>} fn
 *   Async function that receives a Groq API key and returns a result.
 *   It is called fresh on every attempt so the caller can construct a new
 *   ChatGroq / agent using the provided key.
 *
 * @param {number} [maxRetries]
 *   Maximum number of key-rotation retries (defaults to total key count).
 *   After maxRetries+1 attempts, the last error is re-thrown.
 *
 * @returns {Promise<any>}
 */
export async function callWithGroqRotation(fn, maxRetries) {
  const keys = getGroqApiKeys();
  if (maxRetries === undefined) maxRetries = keys.length;

  let lastError;
  const tried = new Set();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const key = getNextGroqApiKey();

    // Skip keys already tried when alternatives exist
    if (tried.has(key) && tried.size < keys.length) {
      attempt--; // don't count this as a real attempt
      continue;
    }
    tried.add(key);

    try {
      return await fn(key);
    } catch (err) {
      // 413 token overflow — key rotation cannot help; throw sentinel immediately
      if (isTokenOverflowError(err)) {
        console.warn(`⚠️  Groq 413 token overflow on key ...${key.slice(-6)}. Conversation history too large — clearing checkpoint.`);
        throw new GroqTokenOverflowError(err);
      }

      if (isRotatableError(err)) {
        const keyShort = `...${key.slice(-6)}`;
        const reason = err?.status === 429 ? '429 rate-limit' : 'tool_use_failed (400)';
        console.warn(
          `⚠️  Groq ${reason} on key ${keyShort} (attempt ${attempt + 1}/${maxRetries + 1}). Rotating to next key...`
        );
        lastError = err;

        // Small exponential backoff before retrying
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
        continue;
      }

      // Non-rotatable error — rethrow immediately
      throw err;
    }
  }

  // All keys exhausted
  console.error('❌ All Groq API keys failed. Last error:', lastError?.message);
  throw lastError;
}
