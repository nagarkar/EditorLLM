// ============================================================
// E2E 6: missing API key — processAll handles the failure gracefully
//
// SERIAL ONLY — this test globally clears GEMINI_API_KEY in GAS
// ScriptProperties, which would break any concurrently-running
// Gemini-calling test. Run via jest.e2e-serial.config.cjs, not
// the parallel jest.e2e.config.cjs.
//
// Mechanism: GeminiService.getApiKey_() throws "Gemini API key not set"
// → CommentProcessor.processAll() catches per-thread → skipped count.
// afterAll always restores the key so other tests (if any follow) are
// unaffected.
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
