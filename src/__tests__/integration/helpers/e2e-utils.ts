// ============================================================
// Shared helpers for E2E test suites.
//
// Extracted from e2e.test.ts so each parallel test file can
// import them without duplicating code.
// ============================================================

import { runGasFunction } from './gas';
import { listAllComments } from './drive';

/**
 * Seeds GEMINI_API_KEY and model overrides from the local test environment
 * into the deployed script's ScriptProperties so all E2E calls use the same
 * cheaper models configured in .env.integration.
 *
 * Called once in a top-level beforeAll from each parallel test file.
 * Safe to call concurrently across workers — each call is idempotent.
 */
export function seedTestEnvironment(webAppUrl: string, token: string): void {
  const apiKey = process.env.GEMINI_API_KEY ?? '';
  if (apiKey) {
    runGasFunction(webAppUrl, 'setScriptProperty', ['GEMINI_API_KEY', apiKey], token);
  }
  const fastModel = process.env.GEMINI_FAST_MODEL;
  if (fastModel) {
    runGasFunction(webAppUrl, 'setScriptProperty', ['GEMINI_FAST_MODEL', fastModel], token);
  }
  const thinkingModel = process.env.GEMINI_THINKING_MODEL;
  if (thinkingModel) {
    runGasFunction(webAppUrl, 'setScriptProperty', ['GEMINI_THINKING_MODEL', thinkingModel], token);
  }
}

/**
 * Waits up to waitMs for a comment to become visible in the Drive API.
 * Retries once after the wait period. No-op if already visible.
 */
export function waitForCommentVisible(
  docId: string, commentId: string, token: string,
  waitMs = 3000
): void {
  const all = listAllComments(docId, token);
  if (!all.find(c => c.id === commentId)) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
  }
}

/**
 * Filters a reply list to only agent-authored replies
 * (identified by the [EditorLLM] prefix or 'AI Editorial Assistant' signature).
 */
export function agentReplies(
  replies: Array<{ content?: string }>
): Array<{ content?: string }> {
  return replies.filter(
    r => r.content?.includes('[EditorLLM]') || r.content?.includes('AI Editorial Assistant')
  );
}
