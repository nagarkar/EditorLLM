// ============================================================
// Real Gemini API caller for integration tests.
//
// Replicates the core logic of GeminiService.generateJson() using
// xmlhttprequest for synchronous HTTP — the same blocking behaviour
// as GAS's UrlFetchApp.fetch().
//
// This is test infrastructure only. Production code uses GeminiService.
// ============================================================

import { INTEGRATION_CONFIG } from '../config';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

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

// ── Text extraction helpers ────────────────────────────────────────────────

/**
 * If the LLM wraps a plain-markdown response inside a JSON code fence
 * (e.g. ```json\n{"markdown":"..."}\n```) despite being asked for bare text,
 * this helper extracts the markdown value. Returns the original string when
 * no JSON wrapper is detected, so plain responses pass through unchanged.
 *
 * Mirrors GeneralPurposeAgent.extractMarkdownFromJsonWrapper_() in production.
 */
function extractPlainText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('#') || !trimmed.startsWith('`')) return trimmed;

  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)```\s*$/);
  if (!fenceMatch) return trimmed;

  try {
    const parsed = JSON.parse(fenceMatch[1].trim());
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed === 'object') {
      // Accept any top-level string value — LLM uses inconsistent key names
      // ("markdown", "updated_instructions", etc.)
      for (const val of Object.values(parsed)) {
        if (typeof val === 'string' && val.trim().length > 0) return val;
      }
    }
  } catch (_) { /* not JSON — return raw */ }

  return trimmed;
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

/**
 * Calls the Gemini API synchronously and returns the raw text response.
 * No JSON schema — use this for prompts that request plain markdown output.
 * Mirrors GeminiService.generateText() / callTextApi_() in production.
 */
export function callGeminiText(
  systemPrompt: string,
  userPrompt: string,
  opts: Omit<GeminiCallOptions, '_retryCount'> = {}
): string {
  const { XMLHttpRequest } = require('xmlhttprequest');

  const tier = opts.tier ?? 'fast';
  const apiKey = opts.apiKeyOverride ?? INTEGRATION_CONFIG.geminiApiKey;
  const model =
    opts.model ??
    INTEGRATION_CONFIG.models[tier as keyof typeof INTEGRATION_CONFIG.models] ??
    DEFAULT_MODELS[tier] ??
    DEFAULT_MODELS.fast;
  const url = `${API_BASE}/${model}:generateContent?key=${apiKey}`;

  const payload: any = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts: [{ text: userPrompt }], role: 'user' }],
    generationConfig: {},
  };
  if (tier === 'thinking') {
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

  const parts: any[] = parsed?.candidates?.[0]?.content?.parts ?? [];
  const textPart = parts.find((p: any) => !p.thought && p.text);
  if (!textPart?.text) {
    throw new Error(`No text content in Gemini response: ${raw.slice(0, 300)}`);
  }
  // Strip JSON wrapper if the LLM ignores the "plain text" instruction.
  return extractPlainText(textPart.text as string);
}

export interface GeminiCallOptions {
  /** Defaults to 'fast'. Use 'thinking' for tests that need extended reasoning. */
  tier?: 'fast' | 'thinking' | 'deepseek';
  /**
   * Direct model name override for this specific call.
   * Takes precedence over INTEGRATION_CONFIG.models and DEFAULT_MODELS.
   * Useful for one-off tests that need a specific model.
   */
  model?: string;
  /** Override the API key — used to test invalid-key error handling. */
  apiKeyOverride?: string;
  /** @internal retry counter to prevent infinite retry loops on JSON parsing. */
  _retryCount?: number;
}

/**
 * Calls the Gemini API synchronously with structured JSON output.
 *
 * Model resolution order (first defined wins):
 *   1. opts.model              — direct per-call override
 *   2. INTEGRATION_CONFIG.models[tier] — env var override (GEMINI_THINKING_MODEL etc.)
 *   3. DEFAULT_MODELS[tier]    — production defaults
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
  const apiKey = opts.apiKeyOverride ?? INTEGRATION_CONFIG.geminiApiKey;
  const model =
    opts.model ??
    INTEGRATION_CONFIG.models[tier as keyof typeof INTEGRATION_CONFIG.models] ??
    DEFAULT_MODELS[tier] ??
    DEFAULT_MODELS.fast;
  const url = `${API_BASE}/${model}:generateContent?key=${apiKey}`;

  const payload: any = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts: [{ text: userPrompt }], role: 'user' }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  };
  if (tier === 'thinking') {
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

  // Skip thought parts; find the first text part that is not a thinking trace
  // (mirrors production GeminiService.callApi_ behaviour).
  const parts: any[] = parsed?.candidates?.[0]?.content?.parts ?? [];
  const textPart = parts.find((p: any) => !p.thought && p.text);
  const text: string | undefined = textPart?.text;
  if (!text) {
    throw new Error(`No text content in Gemini response: ${raw.slice(0, 300)}`);
  }

  try {
    return extractJson(text);
  } catch {
    if (retryCount < MAX_RETRIES) {
      console.warn(`[integration] Retrying callGemini due to malformed JSON (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
      return callGemini(systemPrompt, userPrompt, schema, { ...opts, _retryCount: retryCount + 1 });
    }
    throw new Error(`Gemini returned non-JSON text content: ${text.slice(0, 300)}`);
  }
}
