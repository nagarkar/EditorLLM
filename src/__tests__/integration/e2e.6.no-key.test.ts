// ============================================================
// E2E 6: missing API key — processAll handles the failure gracefully
//
// PURPOSE
// -------
// Verifies that when GEMINI_API_KEY is absent from GAS ScriptProperties,
// commentProcessorRun() degrades gracefully: returns replied:0, skips
// all threads, and does NOT throw an unhandled exception. This tests
// the error-handling path in GeminiService.getApiKey_() and
// CommentProcessor.processAll().
//
// ⚠️ SERIAL ONLY
// ---------------
// This test MUST run in isolation (jest.e2e-serial.config.cjs, maxWorkers:1)
// because it globally clears GEMINI_API_KEY in GAS ScriptProperties.
// If run concurrently with any Gemini-calling test (E2E 3, 5, 7, 8),
// those tests would silently fail with "API key not set" errors.
//
// WORKFLOW
// --------
//   1. seedTestEnvironment() → seeds model overrides (but NOT the key here).
//   2. Creates an @AI comment.
//   3. Clears GEMINI_API_KEY via setScriptProperty('GEMINI_API_KEY', '').
//   4. Calls commentProcessorRun() via doPost.
//   5. Asserts:
//      - result.replied === 0 (no threads were processed)
//      - result.skipped >= 1 (threads exist but were skipped)
//      - result.byAgent is empty (no agent dispatched)
//      - The comment has zero agent replies
//   6. afterAll ALWAYS restores the API key (critical for subsequent runs).
//
// EXECUTION MODEL
// ---------------
//   • Run via: npm run test:e2e (runs after parallel batch completes)
//   • Config: jest.e2e-serial.config.cjs (maxWorkers: 1)
//   • Requires: GEMINI_API_KEY, GOOGLE_DOC_ID, GOOGLE_TOKEN, webAppUrl
//   • The key is restored even if the test fails (afterAll is unconditional).
// ============================================================

import { fetchTabs, createComment, deleteComment, getCommentWithReplies } from './helpers/drive';
import { runGasFunction, getWebAppUrl } from './helpers/gas';
import { INTEGRATION_CONFIG } from './config';
import { seedTestEnvironment, waitForCommentVisible, agentReplies } from './helpers/e2e-utils';

const DOC_ID = INTEGRATION_CONFIG.googleDocId;
const TOKEN = () => process.env.GOOGLE_TOKEN ?? INTEGRATION_CONFIG.googleToken;
const TIMEOUT = 5 * 60 * 1000;

let webAppUrl = '';
try { webAppUrl = getWebAppUrl(); } catch { /* not set yet */ }
const hasCredentials = Boolean(DOC_ID && process.env.GOOGLE_TOKEN && webAppUrl);
const describeE2E = hasCredentials ? describe : describe.skip;

// Seed models (but NOT the API key — the test will clear it in beforeAll).
// We still need model overrides seeded so they don't revert to production defaults.
beforeAll(() => {
  if (hasCredentials) seedTestEnvironment(webAppUrl, TOKEN());
}, TIMEOUT);

describeE2E('E2E: missing API key — processAll handles the failure gracefully', () => {
  let testTabId = '';
  let commentId = '';
  const RUN_ID = Date.now();
  const savedApiKey = process.env.GEMINI_API_KEY ?? '';

  beforeAll(() => {
    const tabs = fetchTabs(DOC_ID, TOKEN());
    if (tabs.length === 0) throw new Error('[E2E-6] Test doc has no tabs');
    testTabId = tabs[0].tabId;
    commentId = createComment(
      DOC_ID, testTabId,
      `@AI [E2E-nokey-${RUN_ID}] This comment should NOT receive a reply (key cleared).`,
      TOKEN()
    );
    console.log(`[E2E-6] comment: ${commentId}`);
    // Clear the key so the web app cannot make Gemini calls.
    runGasFunction(webAppUrl, 'setScriptProperty', ['GEMINI_API_KEY', ''], TOKEN());
  }, TIMEOUT);

  afterAll(() => {
    // Restore the key unconditionally — failure here would break later E2E runs.
    if (savedApiKey) {
      try { runGasFunction(webAppUrl, 'setScriptProperty', ['GEMINI_API_KEY', savedApiKey], TOKEN()); }
      catch (e: any) { console.error(`[E2E-6 afterAll] CRITICAL: failed to restore API key: ${e?.message}`); }
    }
    if (commentId) {
      try { deleteComment(DOC_ID, commentId, TOKEN()); }
      catch (e: any) { if (!e?.message?.includes('404')) console.warn(`[E2E-6 afterAll] ${e?.message}`); }
    }
  }, TIMEOUT);

  it('processAll returns replied:0 and skipped >= 1 — no unhandled exception', () => {
    waitForCommentVisible(DOC_ID, commentId, TOKEN());
    const raw = runGasFunction(webAppUrl, 'commentProcessorRun', [], TOKEN());
    const result = raw as { replied: number; skipped: number; byAgent: Record<string, number> };
    console.log(`[E2E-6] processAll result: ${JSON.stringify(result)}`);
    expect(result.replied).toBe(0);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(Object.keys(result.byAgent)).toHaveLength(0);
  }, TIMEOUT);

  it('the comment has no agent reply when the key is missing', () => {
    const comment = getCommentWithReplies(DOC_ID, commentId, TOKEN());
    const replies = agentReplies(comment.replies ?? []);
    console.log(`[E2E-6] agent replies: ${replies.length}`);
    expect(replies).toHaveLength(0);
  }, TIMEOUT);
});
