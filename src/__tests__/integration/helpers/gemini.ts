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
  // eslint-disable-next-line @typescript-eslint/no-var-requires
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

  const text: string | undefined = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error(`No text content in Gemini response: ${raw.slice(0, 300)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned non-JSON text content: ${text.slice(0, 300)}`);
  }
}
