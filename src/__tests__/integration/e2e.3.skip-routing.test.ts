// ============================================================
// E2E 3: non-routable comments are skipped
//
// Creates one plain comment (no @tag) and one @AI comment.
// Runs commentProcessorRun() and asserts:
//   - plain comment gets no agent reply
//   - @AI comment gets an agent reply
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

beforeAll(() => {
  if (hasCredentials) seedTestEnvironment(webAppUrl, TOKEN());
}, TIMEOUT);

describeE2E('E2E: non-routable comments are skipped', () => {
  let testTabId = '';
  let plainId = '';
  let taggedId = '';
  const RUN_ID = Date.now();

  beforeAll(() => {
    const tabs = fetchTabs(DOC_ID, TOKEN());
    if (tabs.length === 0) throw new Error('[E2E-3] Test doc has no tabs');
    testTabId = tabs[0].tabId;
    plainId = createComment(
      DOC_ID, testTabId,
      `[E2E-skip-${RUN_ID}] Is this sentence well-written?`,
      TOKEN()
    );
    taggedId = createComment(
      DOC_ID, testTabId,
      `@AI [E2E-skip-${RUN_ID}] Acknowledge this non-routable-comments test.`,
      TOKEN()
    );
    console.log(`[E2E-3] plain=${plainId}  tagged=${taggedId}`);
  }, TIMEOUT);

  afterAll(() => {
    for (const id of [plainId, taggedId]) {
      if (!id) continue;
      try { deleteComment(DOC_ID, id, TOKEN()); }
      catch (e: any) { if (!e?.message?.includes('404')) console.warn(`[E2E-3 afterAll] ${e?.message}`); }
    }
  }, TIMEOUT);

  it('processAll reports skipped >= 1 and replied >= 1', () => {
    waitForCommentVisible(DOC_ID, taggedId, TOKEN());
    const raw = runGasFunction(webAppUrl, 'commentProcessorRun', [], TOKEN());
    const result = raw as { replied: number; skipped: number; byAgent: Record<string, number> };
    console.log(`[E2E-3] processAll result: ${JSON.stringify(result)}`);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.replied).toBeGreaterThanOrEqual(1);
  }, TIMEOUT);

  it('the plain comment has no agent reply', () => {
    const comment = getCommentWithReplies(DOC_ID, plainId, TOKEN());
    const replies = agentReplies(comment.replies ?? []);
    console.log(`[E2E-3] plain comment agent replies: ${replies.length}`);
    expect(replies).toHaveLength(0);
  }, TIMEOUT);

  it('the @AI comment has at least one agent reply with EditorLLM signature', () => {
    const comment = getCommentWithReplies(DOC_ID, taggedId, TOKEN());
    const replies = agentReplies(comment.replies ?? []);
    console.log(`[E2E-3] tagged comment agent replies: ${replies.length}`);
    expect(replies.length).toBeGreaterThanOrEqual(1);
    // Verify the EditorLLM signature (merged from E2E 1)
    const agentReply = replies[0];
    expect(agentReply?.content).toContain('AI Editorial Assistant');
    console.log(`[E2E-3] agent reply: ${agentReply?.content?.slice(0, 120)}...`);
  }, TIMEOUT);
});
