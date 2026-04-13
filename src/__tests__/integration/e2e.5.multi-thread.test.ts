// ============================================================
// E2E 5: multi-thread routing — @ai + @architect + @audit in one run
//
// Creates three comments with different agent tags, calls
// commentProcessorRun() once, and asserts each thread was handled.
//
// Uses LONG_TIMEOUT because @architect and @audit call the thinking-tier
// model (GEMINI_THINKING_MODEL). In .env.integration this is set to
// gemini-2.5-flash to stay within the GAS 6-minute execution cap.
//
// Note: this test was previously timing out at 183 s (the 3-minute
// execSync limit) because it was waiting for 4 preceding slow suites
// before running. As a standalone parallel file it runs immediately.
// ============================================================

import { fetchTabs, createComment, deleteComment, getCommentWithReplies } from './helpers/drive';
import { runGasFunction, getWebAppUrl } from './helpers/gas';
import { INTEGRATION_CONFIG } from './config';
import { seedTestEnvironment, waitForCommentVisible, agentReplies } from './helpers/e2e-utils';

const DOC_ID = INTEGRATION_CONFIG.googleDocId;
const TOKEN = () => process.env.GOOGLE_TOKEN ?? INTEGRATION_CONFIG.googleToken;
const TIMEOUT      = 5  * 60 * 1000;
const LONG_TIMEOUT = 10 * 60 * 1000;

let webAppUrl = '';
try { webAppUrl = getWebAppUrl(); } catch { /* not set yet */ }
const hasCredentials = Boolean(DOC_ID && process.env.GOOGLE_TOKEN && webAppUrl);
const describeE2E = hasCredentials ? describe : describe.skip;

beforeAll(() => {
  if (hasCredentials) seedTestEnvironment(webAppUrl, TOKEN());
}, TIMEOUT);

describeE2E('E2E: multi-thread routing — @ai + @architect + @audit dispatched in one run', () => {
  let testTabId = '';
  const ids: Record<string, string> = { ai: '', architect: '', audit: '' };
  const RUN_ID = Date.now();

  beforeAll(() => {
    const tabs = fetchTabs(DOC_ID, TOKEN());
    if (tabs.length === 0) throw new Error('[E2E-5] Test doc has no tabs');
    testTabId = tabs[0].tabId;

    ids.ai = createComment(
      DOC_ID, testTabId,
      `@AI [E2E-multi-${RUN_ID}] Acknowledge this multi-agent routing test.`,
      TOKEN()
    );
    ids.architect = createComment(
      DOC_ID, testTabId,
      `@architect [E2E-multi-${RUN_ID}] Does this passage need structural changes?`,
      TOKEN()
    );
    ids.audit = createComment(
      DOC_ID, testTabId,
      `@audit [E2E-multi-${RUN_ID}] Does this passage contain any logical issues?`,
      TOKEN()
    );
    console.log(`[E2E-5] comments: ${JSON.stringify(ids)}`);
  }, LONG_TIMEOUT);

  afterAll(() => {
    for (const [tag, id] of Object.entries(ids)) {
      if (!id) continue;
      try { deleteComment(DOC_ID, id, TOKEN()); }
      catch (e: any) { if (!e?.message?.includes('404')) console.warn(`[E2E-5 afterAll] ${tag}: ${e?.message}`); }
    }
  }, LONG_TIMEOUT);

  it('processAll routes all three threads and byAgent reflects the correct agent counts', () => {
    waitForCommentVisible(DOC_ID, ids.audit, TOKEN());
    const raw = runGasFunction(webAppUrl, 'commentProcessorRun', [], TOKEN());
    const result = raw as { replied: number; skipped: number; byAgent: Record<string, number> };
    console.log(`[E2E-5] processAll result: ${JSON.stringify(result)}`);
    expect(result.replied).toBeGreaterThanOrEqual(3);
    expect(result.byAgent['@ai']).toBeGreaterThanOrEqual(1);
    expect(result.byAgent['@architect']).toBeGreaterThanOrEqual(1);
    expect(result.byAgent['@audit']).toBeGreaterThanOrEqual(1);
  }, LONG_TIMEOUT);

  it('each comment thread has at least one agent reply with the EditorLLM signature', () => {
    const wait = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    for (const [tag, id] of Object.entries(ids)) {
      let replies: Array<{ content?: string }> = [];
      const deadlineMs = Date.now() + 30_000;
      let pollDelay = 3000;
      while (Date.now() < deadlineMs) {
        const comment = getCommentWithReplies(DOC_ID, id, TOKEN());
        replies = agentReplies(comment.replies ?? []);
        if (replies.length > 0) break;
        wait(pollDelay);
        pollDelay = Math.min(pollDelay * 2, 8000);
      }
      console.log(`[E2E-5] @${tag} (${id}): ${replies.length} agent reply(s) — "${replies[0]?.content?.slice(0, 80) ?? ''}"`);
      expect(replies.length).toBeGreaterThanOrEqual(1);
    }
  }, LONG_TIMEOUT);
});
