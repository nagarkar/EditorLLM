// ============================================================
// E2E 5: multi-thread routing — @ai + @architect + @audit in one run
//
// PURPOSE
// -------
// Proves that a single commentProcessorRun() call correctly dispatches
// comments tagged with different agents (@ai, @architect, @audit) to
// the appropriate agent handler. Validates that the byAgent map in the
// response reflects at least one dispatch per agent type.
//
// WORKFLOW
// --------
//   1. seedTestEnvironment() → seeds API key and model overrides.
//   2. Creates three comments on the first tab:
//      a) @AI — routed to GeneralPurposeAgent (fast tier)
//      b) @architect — routed to ArchitectAgent (thinking tier)
//      c) @audit — routed to AuditAgent (thinking tier)
//   3. Calls commentProcessorRun() via doPost.
//   4. Asserts:
//      - result.replied >= 3
//      - result.byAgent has entries for @ai, @architect, and @audit
//      - Each comment thread has >= 1 agent reply with EditorLLM prefix
//   5. afterAll deletes all three test comments.
//
// TIMEOUT CONSTRAINT
// ------------------
// @architect and @audit use the thinking-tier model (GEMINI_THINKING_MODEL).
// In .env.integration this is set to gemini-2.5-flash to stay within the
// GAS 6-minute execution cap. Uses LONG_TIMEOUT (10 min) because this
// single GAS call processes 3 agents sequentially.
//
// PARALLELISM NOTE
// ----------------
// This is typically the longest-running E2E file (~230-250s). In the
// parallel batch, E2E 3 also calls commentProcessorRun() concurrently.
// GAS queues the calls; reducing from 3 concurrent callers (E2E 1+3+5)
// to 2 (E2E 3+5) reduced wall time from 349s to 244s.
//
// EXECUTION MODEL
// ---------------
//   • Run via: npm run test:e2e-parallel (included in parallel batch)
//   • Requires: GEMINI_API_KEY, GOOGLE_DOC_ID, GOOGLE_TOKEN, webAppUrl
//   • GAS calls: 1 commentProcessorRun (~230-250s)
//   • Reply polling: up to 30s after processAll for Drive eventual consistency
//   • Automatically skipped when credentials are absent
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
