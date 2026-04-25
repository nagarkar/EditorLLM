// ============================================================
// Real Gemini API caller for integration tests.
//
// Replicates the core logic of GeminiService.generate() with a JSON schema using
// xmlhttprequest for synchronous HTTP — the same blocking behaviour
// as GAS's UrlFetchApp.fetch().
//
// This is test infrastructure only. Production code uses GeminiService.
//
// ── Response Cache ────────────────────────────────────────────────────────────
// A persistent prompt→response cache is kept at .integration-gemini-cache.json
// (repo root).  Before every live API call the cache is checked; on a hit the
// stored response is returned immediately with a [CACHE HIT] log line and no
// token accounting.  On a miss the live call is made, logged as usual, and the
// result is written back to the cache file so subsequent runs reuse it.
//
// Cache key = SHA-256 of { systemPrompt, userPrompt, model, schema }.
// The key intentionally excludes the API key so that a key rotation never
// invalidates cached responses.
//
// ── Token estimates ───────────────────────────────────────────────────────────
// Each *live* successful call logs GEMINI MODEL USED and appends one
// token-estimate integer line to .integration-gemini-token-estimates.log
// (repo root) so jest.integration.global-teardown.cjs can print a run summary.
// Cache hits do not contribute to that log.
// ============================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { extractMarkdownFromJsonWrapper } from '../../../agentHelpers';

import { INTEGRATION_CONFIG } from '../config';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// ── Token-estimate log (live calls only) ──────────────────────────────────────

/** One integer per line — read by config/jest/jest.integration.global-teardown.cjs */
const TOKEN_ESTIMATE_LOG = path.resolve(
  __dirname,
  '../../../..',
  '.integration-gemini-token-estimates.log'
);

function estimateGeminiTokens(parsed: any, raw: string, payload: unknown): number {
  const t = parsed?.usageMetadata?.totalTokenCount;
  if (typeof t === 'number' && t > 0) return t;
  const p = JSON.stringify(payload).length;
  return Math.max(1, Math.ceil((p + raw.length) / 4));
}

function logGeminiIntegrationCall(model: string, estimate: number): void {
  console.log(`GEMINI MODEL USED: ${model} | ~${estimate} tokens (est.)`);
  try {
    fs.appendFileSync(TOKEN_ESTIMATE_LOG, `${estimate}\n`, 'utf8');
  } catch {
    /* ignore — teardown still works if file missing */
  }
}

// ── Persistent prompt-response cache ─────────────────────────────────────────

interface CacheEntry {
  /** The returned value: a plain string for text calls, a parsed object for JSON calls. */
  response: any;
  /** ISO-8601 timestamp of when the live API call was made. */
  cachedAt: string;
  /** Gemini model name that produced the response. */
  model: string;
  /** Whether this was a structured-JSON ('json') or plain-text ('text') call. */
  callType: 'json' | 'text';
}

const RESPONSE_CACHE_FILE = path.resolve(
  __dirname,
  '../../../..',
  '.integration-gemini-cache.json'
);

/** In-memory store of all cached prompt→response pairs. */
let promptCache: Record<string, CacheEntry> = {};

/** Load persisted cache from disk at module initialisation. */
function loadCache(): void {
  try {
    if (fs.existsSync(RESPONSE_CACHE_FILE)) {
      const raw = fs.readFileSync(RESPONSE_CACHE_FILE, 'utf8');
      promptCache = JSON.parse(raw) as Record<string, CacheEntry>;
      const n = Object.keys(promptCache).length;
      console.log(`[gemini-cache] Loaded ${n} cached response(s) from ${path.basename(RESPONSE_CACHE_FILE)}`);
    }
  } catch {
    promptCache = {};
  }
}

/** Persist the in-memory cache to disk (best-effort; never throws). */
function saveCache(): void {
  try {
    fs.writeFileSync(RESPONSE_CACHE_FILE, JSON.stringify(promptCache, null, 2), 'utf8');
  } catch {
    /* non-fatal — the cache is still valid in memory for this run */
  }
}

/**
 * Derives a stable cache key from the full prompt context.
 * The model name is included so that fast-tier and thinking-tier responses for
 * the same prompt are stored independently (their quality differs).
 * The API key is intentionally excluded — key rotation must not bust the cache.
 */
function makeCacheKey(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  schema?: object
): string {
  const payload = JSON.stringify({
    systemPrompt,
    userPrompt,
    model,
    schema: schema ?? null,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

// Load persisted responses when this module is first imported.
loadCache();

// ── Text extraction helpers ────────────────────────────────────────────────

function extractPlainText(raw: string): string {
  return extractMarkdownFromJsonWrapper(raw);
}

// ── JSON extraction helpers ────────────────────────────────────────────────

/**
 * Attempts to extract and parse JSON from a string that may be wrapped in
 * markdown code fences, contain BOM markers, or include other non-JSON noise.
 *
 * Strategy (in order):
 *   1. Direct JSON.parse after trimming whitespace/BOM
 *   2. Strip markdown code fences (```json ... ``` or ``` ... ```) and retry
 *   3. Extract first top-level { ... } via brace-matching and retry
 *
 * Throws if all strategies fail.
 */
function extractJson(raw: string): any {
  // 1. Trim whitespace and BOM
  const trimmed = raw.replace(/^\uFEFF/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue to next strategy
  }

  // 2. Strip markdown code fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```\s*$/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // continue
    }
  }

  // 3. Brace-matching: find the first top-level { ... }
  const braceStart = trimmed.indexOf('{');
  if (braceStart >= 0) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = braceStart; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      if (ch === '}') { depth--; if (depth === 0) {
        try {
          return JSON.parse(trimmed.slice(braceStart, i + 1));
        } catch {
          break;
        }
      }}
    }
  }

  throw new Error(`Unable to extract JSON: ${raw.slice(0, 300)}`);
}

// ── Default models ─────────────────────────────────────────────────────────

/**
 * Production-equivalent default model names — mirror DEFAULT_MODELS in Types.ts.
 * These are only used when no override is provided via INTEGRATION_CONFIG.models
 * or the model option.
 */
const DEFAULT_MODELS: Record<string, string> = {
  fast:     'gemini-3-flash-preview',
  thinking: 'gemini-3.1-pro-preview',
  deepseek: 'gemini-2.0-flash-thinking-exp-01-21',
};

export function supportsThinkingConfig(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return false;

  return [
    /^gemini-2\.5-pro(?:-|$)/,
    /^gemini-2\.5-flash(?:-lite)?(?:-|$)/,
    /^gemini-3(?:\.\d+)?-flash-preview(?:-|$)/,
    /^gemini-3(?:\.\d+)?-pro-preview(?:-|$)/,
    /^gemini-3(?:\.\d+)?-pro-image-preview(?:-|$)/,
  ].some(rx => rx.test(normalized));
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface GeminiCallOptions {
  /** Defaults to 'fast'. Use 'thinking' for tests that need extended reasoning. */
  tier?: 'fast' | 'thinking' | 'deepseek';
  /**
   * Direct model name override for this specific call.
   * Takes precedence over INTEGRATION_CONFIG.models and DEFAULT_MODELS.
   * Useful for one-off tests that need a specific model.
   */
  model?: string;
  /** Simulate an invalid API key — bypasses the cache and sends a known-bad key. */
  testWithInvalidKey?: boolean;
  /** @internal retry counter to prevent infinite retry loops on JSON parsing. */
  _retryCount?: number;
}

/**
 * Calls the Gemini API synchronously and returns the raw text response.
 * No JSON schema — use this for prompts that request plain markdown output.
 * Mirrors GeminiService.generate() without a schema (plain text) in production.
 *
 * Checks the prompt-response cache before making a live API call.
 * On a cache hit, logs [CACHE HIT] and returns immediately (no token accounting).
 * On a cache miss, makes the live call, logs it, and writes the result to cache.
 */
export function callGeminiText(
  systemPrompt: string,
  userPrompt: string,
  opts: Omit<GeminiCallOptions, '_retryCount'> = {}
): string {
  const { XMLHttpRequest } = require('xmlhttprequest');

  const tier = opts.tier ?? 'fast';
  const apiKey = opts.testWithInvalidKey ? 'INVALID_API_KEY_FOR_TESTING' : INTEGRATION_CONFIG.geminiApiKey;
  const model =
    opts.model ??
    INTEGRATION_CONFIG.models[tier as keyof typeof INTEGRATION_CONFIG.models] ??
    DEFAULT_MODELS[tier] ??
    DEFAULT_MODELS.fast;

  // ── Cache check ──────────────────────────────────────────────────────────
  // Skip when testWithInvalidKey is set — the live call must reach the API so
  // the invalid key triggers the expected error (cache key excludes key).
  const cacheKey = makeCacheKey(systemPrompt, userPrompt, model);
  if (!opts.testWithInvalidKey) {
    const cached = promptCache[cacheKey];
    if (cached) {
      console.log(
        `[CACHE HIT] ${model} — returning cached text response (cached ${cached.cachedAt})`
      );
      return cached.response as string;
    }
  }

  // ── Live API call ────────────────────────────────────────────────────────
  const url = `${API_BASE}/${model}:generateContent?key=${apiKey}`;

  const payload: any = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts: [{ text: userPrompt }], role: 'user' }],
    generationConfig: {},
  };
  if (tier === 'thinking' && supportsThinkingConfig(model)) {
    payload.generationConfig.thinkingConfig = { thinkingBudget: 8192 };
  }

  const xhr = new XMLHttpRequest();
  xhr.open('POST', url, false);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.send(JSON.stringify(payload));

  const raw: string = xhr.responseText;
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Gemini response is not valid JSON (HTTP ${xhr.status}): ${raw.slice(0, 300)}`);
  }

  if (parsed.error) {
    throw new Error(
      `Gemini API error ${parsed.error.code ?? xhr.status}: ${parsed.error.message ?? raw.slice(0, 200)}`
    );
  }

  logGeminiIntegrationCall(model, estimateGeminiTokens(parsed, raw, payload));

  const parts: any[] = parsed?.candidates?.[0]?.content?.parts ?? [];
  const textPart = parts.find((p: any) => !p.thought && p.text);
  if (!textPart?.text) {
    throw new Error(`No text content in Gemini response: ${raw.slice(0, 300)}`);
  }
  // Strip JSON wrapper if the LLM ignores the "plain text" instruction.
  const result = extractPlainText(textPart.text as string);

  // ── Write to cache ───────────────────────────────────────────────────────
  promptCache[cacheKey] = {
    response: result,
    cachedAt: new Date().toISOString(),
    model,
    callType: 'text',
  };
  saveCache();

  return result;
}

/**
 * Calls the Gemini API synchronously with structured JSON output.
 *
 * Model resolution order (first defined wins):
 *   1. opts.model              — direct per-call override
 *   2. INTEGRATION_CONFIG.models[tier] — env var override (GEMINI_THINKING_MODEL etc.)
 *   3. DEFAULT_MODELS[tier]    — production defaults
 *
 * Checks the prompt-response cache before making a live API call.
 * On a cache hit, logs [CACHE HIT] and returns immediately (no token accounting).
 * On a cache miss, makes the live call, logs it, and writes the result to cache.
 *
 * Throws if the API returns an error or the response cannot be parsed.
 */
export function callGemini(
  systemPrompt: string,
  userPrompt: string,
  schema: object,
  opts: GeminiCallOptions = {}
): any {
  const { XMLHttpRequest } = require('xmlhttprequest');

  const MAX_RETRIES = 2;
  const tier = opts.tier ?? 'fast';
  const retryCount = opts._retryCount ?? 0;
  const apiKey = opts.testWithInvalidKey ? 'INVALID_API_KEY_FOR_TESTING' : INTEGRATION_CONFIG.geminiApiKey;
  const model =
    opts.model ??
    INTEGRATION_CONFIG.models[tier as keyof typeof INTEGRATION_CONFIG.models] ??
    DEFAULT_MODELS[tier] ??
    DEFAULT_MODELS.fast;

  // ── Cache check (only on the first attempt; retries always hit the API) ──
  // Retries are triggered by malformed JSON, so there's no valid cached response
  // to return — we need a fresh API call.
  // Skip when testWithInvalidKey is set — the live call must reach the API so
  // the invalid key triggers the expected error (cache key excludes key).
  if (retryCount === 0 && !opts.testWithInvalidKey) {
    const cacheKey = makeCacheKey(systemPrompt, userPrompt, model, schema);
    const cached = promptCache[cacheKey];
    if (cached) {
      console.log(
        `[CACHE HIT] ${model} — returning cached JSON response (cached ${cached.cachedAt})`
      );
      return cached.response;
    }
  }

  // ── Live API call ────────────────────────────────────────────────────────
  const url = `${API_BASE}/${model}:generateContent?key=${apiKey}`;

  const payload: any = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts: [{ text: userPrompt }], role: 'user' }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  };
  if (tier === 'thinking' && supportsThinkingConfig(model)) {
    payload.generationConfig.thinkingConfig = { thinkingBudget: 8192 };
  }

  const xhr = new XMLHttpRequest();
  xhr.open('POST', url, false); // false = synchronous
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.send(JSON.stringify(payload));

  const raw: string = xhr.responseText;
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Gemini response is not valid JSON (HTTP ${xhr.status}): ${raw.slice(0, 300)}`);
  }

  if (parsed.error) {
    throw new Error(
      `Gemini API error ${parsed.error.code ?? xhr.status}: ${parsed.error.message ?? raw.slice(0, 200)}`
    );
  }

  logGeminiIntegrationCall(model, estimateGeminiTokens(parsed, raw, payload));

  // Skip thought parts; find the first text part that is not a thinking trace
  // (mirrors production GeminiService.callApi_ behaviour).
  const parts: any[] = parsed?.candidates?.[0]?.content?.parts ?? [];
  const textPart = parts.find((p: any) => !p.thought && p.text);
  const text: string | undefined = textPart?.text;
  if (!text) {
    throw new Error(`No text content in Gemini response: ${raw.slice(0, 300)}`);
  }

  let result: any;
  try {
    result = extractJson(text);
  } catch {
    if (retryCount < MAX_RETRIES) {
      console.warn(`[integration] Retrying callGemini due to malformed JSON (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
      return callGemini(systemPrompt, userPrompt, schema, { ...opts, _retryCount: retryCount + 1 });
    }
    throw new Error(`Gemini returned non-JSON text content: ${text.slice(0, 300)}`);
  }

  // ── Write to cache (only on successful first-attempt parse) ──────────────
  const cacheKey = makeCacheKey(systemPrompt, userPrompt, model, schema);
  promptCache[cacheKey] = {
    response: result,
    cachedAt: new Date().toISOString(),
    model,
    callType: 'json',
  };
  saveCache();

  return result;
}
