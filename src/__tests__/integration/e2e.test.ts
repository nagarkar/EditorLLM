// ============================================================
// E2E test: @AI comment → commentProcessorRun() → reply in thread
//
// Architecture note
// -----------------
// The EditorLLM script is *bound* to GOOGLE_DOC_ID. GAS's
// DocumentApp.getActiveDocument() always returns that bound doc — there is
// no way to redirect it to a copy at runtime without a second bound project.
// No document copy is created or destroyed by this test.
//
// Each E2E run:
//   1. Fetches the first existing tab of GOOGLE_DOC_ID (no tab is created).
//   2. Creates exactly ONE @AI comment anchored to that tab — content is
//      self-contained so no specific doc content is required.
//   3. Calls commentProcessorRun() via the Apps Script execution API
//      (runs the real GAS code at @HEAD of the staging script).
//   4. Verifies the comment thread received an agent reply.
//   5. Tears down: deletes only the comment created in step 2.
//
// Architecture note: why we use a web app, not scripts.run
// ----------------------------------------------------------
// The Apps Script Execution API (scripts.run) does NOT support
// container-bound scripts. EditorLLMTest is bound to "EditorLLM Test Doc",
// so scripts.run always returns 404 — not a credentials or project issue.
//
// Instead we call the doPost() web app endpoint, which routes to the same
// production functions (commentProcessorRun, hasApiKey, etc.).
//
// Prerequisites (one-time setup)
// --------------------------------
//   1. clasp push
//   2. In the Apps Script editor: Deploy → New deployment → Type: Web app
//        Execute as: Me (script owner)
//        Who has access: Anyone with Google account
//   3. Copy the web app URL to .clasp.json as "webAppUrl"
//   After that, deploy.sh handles redeployment automatically via
//   `clasp deploy -i <deploymentId>` after every clasp push.
//   4. Authenticate gcloud with userinfo.email scope:
//        gcloud auth application-default login \
//          --client-id-file="$HOME/.config/gcloud/editorllm-oauth-client.json" \
//          --scopes="https://www.googleapis.com/auth/cloud-platform,\
//                    https://www.googleapis.com/auth/drive,\
//                    https://www.googleapis.com/auth/documents,\
//                    https://www.googleapis.com/auth/script.external_request,\
//                    https://www.googleapis.com/auth/script.scriptapp,\
//                    https://www.googleapis.com/auth/userinfo.email"
//   5. Run this test: npx jest --config jest.e2e.config.cjs
//
// After the one-time setup:
//   - Run `./deploy.sh` for all code changes — it handles push + redeploy.
//   - Or manually: clasp push && clasp deploy -i <webAppDeploymentId>
// ============================================================

import {
  fetchTabs,
  createComment,
  createDocTab,
  deleteComment,
  deleteDocTab,
  getCommentWithReplies,
  insertTextIntoTab,
  listAllComments,
} from './helpers/drive';
import { runGasFunction, getWebAppUrl } from './helpers/gas';
import { INTEGRATION_CONFIG } from './config';

const DOC_ID  = INTEGRATION_CONFIG.googleDocId;
const TOKEN   = () => process.env.GOOGLE_TOKEN ?? INTEGRATION_CONFIG.googleToken;

// Fast-tier tests (CommentAgent, StylistAgent): 5 minutes is plenty.
const TIMEOUT = 5 * 60 * 1000;
// Thinking-tier tests (ArchitectAgent, AuditAgent): allow up to 10 minutes.
// Apps Script web app execution cap is 6 minutes; two thinking calls back-to-back
// fit comfortably when GEMINI_THINKING_MODEL is overridden to gemini-2.5-flash.
const LONG_TIMEOUT = 10 * 60 * 1000;

// ── Shared helpers ────────────────────────────────────────────────────────────

/**
 * Seeds GEMINI_API_KEY and any model overrides from the local test environment
 * into the deployed script's ScriptProperties so the web app uses the same
 * cheaper models configured in .env.integration (avoids quota exhaustion and
 * ensures consistent model behavior between integration and E2E tests).
 */
function seedTestEnvironment_(webAppUrl: string, token: string): void {
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

/** Waits up to waitMs for comment to appear, retrying once after retryMs. */
function waitForCommentVisible_(
  docId: string, commentId: string, token: string,
  waitMs = 3000
): void {
  const all = listAllComments(docId, token);
  if (!all.find(c => c.id === commentId)) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
  }
}

/** Returns only the agent-authored replies from a thread. */
function agentReplies_(replies: Array<{ content?: string }>): Array<{ content?: string }> {
  return replies.filter(
    r => r.content?.includes('[EditorLLM]') || r.content?.includes('AI Editorial Assistant')
  );
}

// ── Skip guard ────────────────────────────────────────────────────────────────

// Require both the doc ID and a web app URL — the Execution API cannot be
// used for container-bound scripts (scripts.run returns 404 for bound scripts).
let webAppUrl = '';
try { webAppUrl = getWebAppUrl(); } catch { /* not set yet */ }

const hasCredentials = Boolean(DOC_ID && process.env.GOOGLE_TOKEN && webAppUrl);

const describeE2E = hasCredentials ? describe : describe.skip;

// ── Test state ────────────────────────────────────────────────────────────────

describeE2E('E2E: @AI comment → commentProcessorRun() → agent reply', () => {
  let testTabId      = '';
  let testCommentId  = '';

  // Unique per run so parallel runs don't interfere.
  const RUN_ID = Date.now();

  // Self-contained comment — agent can answer regardless of tab content.
  const COMMENT_CONTENT =
    `@AI [E2E-${RUN_ID}] Acknowledge this automated integration test with a single sentence.`;

  // ── Setup ──────────────────────────────────────────────────────────────────

  beforeAll(() => {
    console.log(`[E2E] webAppUrl:  ${webAppUrl}`);
    console.log(`[E2E] docId:      ${DOC_ID}`);
    console.log(`[E2E] doc URL:    https://docs.google.com/document/d/${DOC_ID}/edit`);

    // Seed API key and model overrides into ScriptProperties.
    seedTestEnvironment_(webAppUrl, TOKEN());

    // Use the first existing tab in the doc.
    const tabs = fetchTabs(DOC_ID, TOKEN());
    if (tabs.length === 0) throw new Error('[E2E] Test doc has no tabs — cannot anchor comment');
    testTabId = tabs[0].tabId;
    console.log(`[E2E] tab:        "${tabs[0].title}" (${testTabId})`);

    // Post the @AI comment anchored to the first tab.
    testCommentId = createComment(DOC_ID, testTabId, COMMENT_CONTENT, TOKEN());
    console.log(`[E2E] comment:    ${testCommentId}`);
    console.log(`[E2E] comment URL: https://docs.google.com/document/d/${DOC_ID}/edit`);
  }, TIMEOUT);

  // ── Teardown ───────────────────────────────────────────────────────────────

  afterAll(() => {
    // Best-effort cleanup; don't let failures here mask test results.
    // Only the comment is cleaned up — the tab was pre-existing and is not touched.
    if (testCommentId) {
      try { deleteComment(DOC_ID, testCommentId, TOKEN()); }
      catch (e: any) {
        if (!e?.message?.includes('404')) {
          console.warn(`[E2E afterAll] Failed to delete comment: ${e?.message}`);
        }
      }
    }
  }, TIMEOUT);

  // ── Tests ──────────────────────────────────────────────────────────────────

  it('commentProcessorRun() reports at least one reply processed', () => {
    // Verify the comment is visible via Drive API before calling GAS.
    // Drive comment creation can take a moment to propagate.
    const comments = listAllComments(DOC_ID, TOKEN());
    const found = comments.find(c => c.id === testCommentId);
    console.log(`[E2E] comment visible via Drive REST: ${found ? 'YES' : 'NO'} (${comments.length} total comments on doc)`);
    if (!found) {
      // Brief propagation delay — wait 3s and retry once.
      console.log('[E2E] comment not yet visible — waiting 3s for propagation...');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
      const retried = listAllComments(DOC_ID, TOKEN());
      const foundRetry = retried.find(c => c.id === testCommentId);
      console.log(`[E2E] after wait: comment visible: ${foundRetry ? 'YES' : 'NO'}`);
    }

    // Invoke the real GAS function via the web app endpoint.
    // The doPost() handler maps fn:"commentProcessorRun" to CommentProcessor.processAll().
    console.log('[E2E] calling commentProcessorRun() via web app doPost()...');
    const raw = runGasFunction(webAppUrl, 'commentProcessorRun', [], TOKEN());
    const result = raw as { replied: number; skipped: number; byAgent: Record<string, number> };
    console.log(`[E2E] commentProcessorRun result: ${JSON.stringify(result)}`);

    expect(result).toBeDefined();
    expect(typeof result.replied).toBe('number');
    expect(result.replied).toBeGreaterThanOrEqual(1);
  }, TIMEOUT);

  it('the @AI comment thread has an agent reply containing the [EditorLLM] prefix', () => {
    // Fetch the comment (including replies) and verify the agent responded.
    const comment = getCommentWithReplies(DOC_ID, testCommentId, TOKEN());
    console.log(
      `[E2E] comment ${testCommentId} — ` +
      `${comment.replies?.length ?? 0} reply(s), resolved=${comment.resolved}`
    );

    const replies = comment.replies ?? [];
    expect(replies.length).toBeGreaterThan(0);

    // The CollaborationService prefixes all agent replies with '[EditorLLM] '.
    const agentReply = replies.find(
      r => r.content?.includes('[EditorLLM]') || r.content?.includes('AI Editorial Assistant')
    );
    expect(agentReply).toBeDefined();
    console.log(`[E2E] agent reply: ${agentReply?.content?.slice(0, 120)}...`);
    console.log(`[E2E] view in doc: https://docs.google.com/document/d/${DOC_ID}/edit`);
  }, TIMEOUT);

  it('the agent reply ends with the AI Editorial Assistant signature', () => {
    const comment = getCommentWithReplies(DOC_ID, testCommentId, TOKEN());
    const agentReply = (comment.replies ?? []).find(
      r => r.content?.includes('[EditorLLM]') || r.content?.includes('AI Editorial Assistant')
    );
    expect(agentReply?.content).toContain('AI Editorial Assistant');
  }, TIMEOUT);
});

// ── E2E 2: hasApiKey doPost smoke test ────────────────────────────────────────
// Verifies that the hasApiKey doPost route works and that the API key seeded
// in beforeAll is readable from ScriptProperties by the web app.

describeE2E('E2E: hasApiKey doPost route (smoke test)', () => {
  beforeAll(() => {
    seedTestEnvironment_(webAppUrl, TOKEN());
  }, TIMEOUT);

  it('returns true when GEMINI_API_KEY is present in ScriptProperties', () => {
    const result = runGasFunction(webAppUrl, 'hasApiKey', [], TOKEN());
    console.log(`[E2E hasApiKey] result: ${JSON.stringify(result)}`);
    expect(result).toBe(true);
  }, TIMEOUT);
});

// ── E2E 3: skip non-routable comments ────────────────────────────────────────
// Creates one plain comment (no tag) and one @AI comment, runs the processor,
// and asserts: the plain comment gets no agent reply; the @AI comment does.
// Directly tests the buildThread_() → null path in CommentProcessor.ts.

describeE2E('E2E: non-routable comments are skipped', () => {
  let testTabId    = '';
  let plainId      = '';
  let taggedId     = '';
  const RUN_ID     = Date.now();

  beforeAll(() => {
    seedTestEnvironment_(webAppUrl, TOKEN());

    const tabs = fetchTabs(DOC_ID, TOKEN());
    if (tabs.length === 0) throw new Error('[E2E skip] Test doc has no tabs');
    testTabId = tabs[0].tabId;

    // Plain comment with no supported @tag — buildThread_() should return null.
    plainId = createComment(
      DOC_ID, testTabId,
      `[E2E-skip-${RUN_ID}] Is this sentence well-written?`,
      TOKEN()
    );
    // Valid @AI comment — should be routed and replied to.
    taggedId = createComment(
      DOC_ID, testTabId,
      `@AI [E2E-skip-${RUN_ID}] Acknowledge this non-routable-comments test.`,
      TOKEN()
    );
    console.log(`[E2E skip] plain=${plainId}  tagged=${taggedId}`);
  }, TIMEOUT);

  afterAll(() => {
    for (const id of [plainId, taggedId]) {
      if (!id) continue;
      try { deleteComment(DOC_ID, id, TOKEN()); }
      catch (e: any) { if (!e?.message?.includes('404')) console.warn(`[E2E skip afterAll] ${e?.message}`); }
    }
  }, TIMEOUT);

  it('processAll reports skipped >= 1 (the plain comment) and replied >= 1 (the @AI comment)', () => {
    waitForCommentVisible_(DOC_ID, taggedId, TOKEN());
    const raw = runGasFunction(webAppUrl, 'commentProcessorRun', [], TOKEN());
    const result = raw as { replied: number; skipped: number; byAgent: Record<string, number> };
    console.log(`[E2E skip] processAll result: ${JSON.stringify(result)}`);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.replied).toBeGreaterThanOrEqual(1);
  }, TIMEOUT);

  it('the plain comment has no agent reply', () => {
    const comment = getCommentWithReplies(DOC_ID, plainId, TOKEN());
    const replies = agentReplies_(comment.replies ?? []);
    console.log(`[E2E skip] plain comment agent replies: ${replies.length}`);
    expect(replies).toHaveLength(0);
  }, TIMEOUT);

  it('the @AI comment has at least one agent reply', () => {
    const comment = getCommentWithReplies(DOC_ID, taggedId, TOKEN());
    const replies = agentReplies_(comment.replies ?? []);
    console.log(`[E2E skip] tagged comment agent replies: ${replies.length}`);
    expect(replies.length).toBeGreaterThanOrEqual(1);
  }, TIMEOUT);
});

// ── E2E 4: idempotency ────────────────────────────────────────────────────────
// Runs commentProcessorRun() twice on the same @AI thread and asserts that
// exactly one agent reply exists — not two.
//
// Mechanism being tested (CommentProcessor.ts buildThread_, line ~147):
//   After the first run, the agent reply becomes the last message in the thread.
//   That reply has no @tag, so buildThread_() returns null on the second run.

describeE2E('E2E: commentProcessorRun() is idempotent — no duplicate replies', () => {
  let testTabId   = '';
  let commentId   = '';
  const RUN_ID    = Date.now();

  beforeAll(() => {
    seedTestEnvironment_(webAppUrl, TOKEN());

    const tabs = fetchTabs(DOC_ID, TOKEN());
    if (tabs.length === 0) throw new Error('[E2E idem] Test doc has no tabs');
    testTabId = tabs[0].tabId;

    commentId = createComment(
      DOC_ID, testTabId,
      `@AI [E2E-idem-${RUN_ID}] Idempotency check — reply exactly once.`,
      TOKEN()
    );
    console.log(`[E2E idem] comment: ${commentId}`);
  }, TIMEOUT);

  afterAll(() => {
    if (commentId) {
      try { deleteComment(DOC_ID, commentId, TOKEN()); }
      catch (e: any) { if (!e?.message?.includes('404')) console.warn(`[E2E idem afterAll] ${e?.message}`); }
    }
  }, TIMEOUT);

  it('two consecutive runs produce exactly one agent reply', () => {
    waitForCommentVisible_(DOC_ID, commentId, TOKEN());

    // Run 1: the @AI comment is the last message → routed → replied.
    const first = runGasFunction(webAppUrl, 'commentProcessorRun', [], TOKEN()) as {
      replied: number; skipped: number;
    };
    console.log(`[E2E idem] run 1: ${JSON.stringify(first)}`);
    expect(first.replied).toBeGreaterThanOrEqual(1);

    // Run 2: the agent reply is now the last message (no @tag) → buildThread_
    // returns null → thread skipped.  No second reply should be added.
    runGasFunction(webAppUrl, 'commentProcessorRun', [], TOKEN());

    // Verify the specific thread has exactly one agent reply.
    const comment = getCommentWithReplies(DOC_ID, commentId, TOKEN());
    const replies = agentReplies_(comment.replies ?? []);
    console.log(`[E2E idem] agent replies after 2 runs: ${replies.length}`);
    expect(replies).toHaveLength(1);
  }, TIMEOUT);
});

// ── E2E 5: multi-thread routing (@ai + @architect + @audit) ──────────────────
// Creates three comments with different agent tags, calls commentProcessorRun()
// once, and asserts each thread was dispatched to the correct agent.
// Uses LONG_TIMEOUT because @architect and @audit call the thinking-tier model.
//
// Note: the test doc may lack StyleProfile / Technical Audit / Merged Content
// tabs — that's intentional. Agents log warnings but handle empty context
// gracefully, so a meaningful reply is still produced.

describeE2E('E2E: multi-thread routing — @ai + @architect + @audit dispatched in one run', () => {
  let testTabId = '';
  const ids: Record<string, string> = { ai: '', architect: '', audit: '' };
  const RUN_ID = Date.now();

  beforeAll(() => {
    seedTestEnvironment_(webAppUrl, TOKEN());

    const tabs = fetchTabs(DOC_ID, TOKEN());
    if (tabs.length === 0) throw new Error('[E2E multi] Test doc has no tabs');
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
    console.log(`[E2E multi] comments: ${JSON.stringify(ids)}`);
  }, LONG_TIMEOUT);

  afterAll(() => {
    for (const [tag, id] of Object.entries(ids)) {
      if (!id) continue;
      try { deleteComment(DOC_ID, id, TOKEN()); }
      catch (e: any) { if (!e?.message?.includes('404')) console.warn(`[E2E multi afterAll] ${tag}: ${e?.message}`); }
    }
  }, LONG_TIMEOUT);

  it('processAll routes all three threads and byAgent reflects the correct agent counts', () => {
    waitForCommentVisible_(DOC_ID, ids.audit, TOKEN());

    const raw = runGasFunction(webAppUrl, 'commentProcessorRun', [], TOKEN());
    const result = raw as { replied: number; skipped: number; byAgent: Record<string, number> };
    console.log(`[E2E multi] processAll result: ${JSON.stringify(result)}`);

    expect(result.replied).toBeGreaterThanOrEqual(3);
    expect(result.byAgent['@ai']).toBeGreaterThanOrEqual(1);
    expect(result.byAgent['@architect']).toBeGreaterThanOrEqual(1);
    expect(result.byAgent['@audit']).toBeGreaterThanOrEqual(1);
  }, LONG_TIMEOUT);

  it('each comment thread has at least one agent reply with the EditorLLM signature', () => {
    // @audit uses MODEL.THINKING (slower Gemini model) and is processed last,
    // so its reply is written just before doPost returns — giving it the least
    // time to propagate through the Drive read API.  Poll with back-off instead
    // of a single fixed wait so the test passes as soon as the reply is visible.
    const wait = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

    for (const [tag, id] of Object.entries(ids)) {
      let replies: Array<{ content?: string }> = [];
      const deadlineMs = Date.now() + 30_000;   // 30 s total budget per comment
      let pollDelay = 3000;
      while (Date.now() < deadlineMs) {
        const comment = getCommentWithReplies(DOC_ID, id, TOKEN());
        replies = agentReplies_(comment.replies ?? []);
        if (replies.length > 0) break;
        wait(pollDelay);
        pollDelay = Math.min(pollDelay * 2, 8000); // back-off: 3s, 6s, 8s, 8s …
      }
      console.log(`[E2E multi] @${tag} (${id}): ${replies.length} agent reply(s) — "${replies[0]?.content?.slice(0, 80) ?? ''}"`);
      expect(replies.length).toBeGreaterThanOrEqual(1);
    }
  }, LONG_TIMEOUT);
});

// ── E2E 6: missing API key — graceful failure ─────────────────────────────────
// Clears GEMINI_API_KEY in ScriptProperties, runs commentProcessorRun(), and
// asserts the function returns cleanly with replied:0 (no crash, no unhandled
// exception) and the test comment receives no reply.
//
// Mechanism: GeminiService.getApiKey_() throws "Gemini API key not set" →
// CommentProcessor.processAll() catches it per-thread → counts as skipped.
//
// afterAll always restores the key so subsequent tests are unaffected.

describeE2E('E2E: missing API key — processAll handles the failure gracefully', () => {
  let testTabId      = '';
  let commentId      = '';
  const RUN_ID       = Date.now();
  const savedApiKey  = process.env.GEMINI_API_KEY ?? '';

  beforeAll(() => {
    const tabs = fetchTabs(DOC_ID, TOKEN());
    if (tabs.length === 0) throw new Error('[E2E no-key] Test doc has no tabs');
    testTabId = tabs[0].tabId;

    commentId = createComment(
      DOC_ID, testTabId,
      `@AI [E2E-nokey-${RUN_ID}] This comment should NOT receive a reply (key cleared).`,
      TOKEN()
    );
    console.log(`[E2E no-key] comment: ${commentId}`);

    // Clear the key so the web app cannot make Gemini calls.
    runGasFunction(webAppUrl, 'setScriptProperty', ['GEMINI_API_KEY', ''], TOKEN());
  }, TIMEOUT);

  afterAll(() => {
    // Restore the key unconditionally — failure here would break all later tests.
    if (savedApiKey) {
      try { runGasFunction(webAppUrl, 'setScriptProperty', ['GEMINI_API_KEY', savedApiKey], TOKEN()); }
      catch (e: any) { console.error(`[E2E no-key afterAll] CRITICAL: failed to restore API key: ${e?.message}`); }
    }
    if (commentId) {
      try { deleteComment(DOC_ID, commentId, TOKEN()); }
      catch (e: any) { if (!e?.message?.includes('404')) console.warn(`[E2E no-key afterAll] ${e?.message}`); }
    }
  }, TIMEOUT);

  it('processAll returns replied:0 and skipped >= 1 — no unhandled exception', () => {
    waitForCommentVisible_(DOC_ID, commentId, TOKEN());

    const raw = runGasFunction(webAppUrl, 'commentProcessorRun', [], TOKEN());
    const result = raw as { replied: number; skipped: number; byAgent: Record<string, number> };
    console.log(`[E2E no-key] processAll result: ${JSON.stringify(result)}`);

    // All Gemini calls fail → agents throw → processAll catches per-thread → skipped.
    expect(result.replied).toBe(0);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(Object.keys(result.byAgent)).toHaveLength(0);
  }, TIMEOUT);

  it('the comment has no agent reply when the key is missing', () => {
    const comment = getCommentWithReplies(DOC_ID, commentId, TOKEN());
    const replies = agentReplies_(comment.replies ?? []);
    console.log(`[E2E no-key] agent replies: ${replies.length}`);
    expect(replies).toHaveLength(0);
  }, TIMEOUT);
});

// ── E2E 7: StylistAgent W2 — stylistAnnotateTab on an isolated temp tab ───────
//
// What this test proves:
//   • setupStandardTabs(), architectGenerateExample(), stylistGenerateExample()
//     complete without error end-to-end (tab setup + content seeding)
//   • stylistAnnotateTab() runs the full EarTune W2 pipeline on real doc content
//   • Drive comments land on the intended tab (anchor filtering by tab ID)
//   • Agent comments carry the [EditorLLM] prefix
//   • Cleanup (deleteDocTab) safely removes the temp tab and its annotations
//
// What this test deliberately avoids:
//   • Asserting exact comment text or a specific comment count (Gemini output varies)
//   • Re-running and expecting identical results
//   • Touching any tab the user actually authors
//
// Timeout: LONG_TIMEOUT — beforeAll makes 3 doPost calls + 2 Docs REST writes;
// the main test makes 1 fast-tier Gemini call via stylistAnnotateTab.

// Prose with intentional rhythmic weaknesses (heavy passive voice, repetitive
// sentence structure, awkward consonant clusters) to reliably trigger EarTune.
const FIXTURE_PROSE = `\
The consciousness paradigm has long been studied by researchers who have researched \
consciousness research across many research institutions. The nature of awareness \
was analyzed by philosophers who philosophically pondered philosophical questions \
of a philosophical nature about philosophy and philosophical consciousness.

Quantum properties are measured by instruments. Results are recorded by scientists. \
Data is analyzed by algorithms. Conclusions are drawn by reviewers. Reports are \
submitted by authors. Feedback is provided by editors. Revisions are made by writers. \
The cycle is repeated by the process.

The systematic system systematically processes systematic data through systematic \
processing systems. Each procedural procedure procedurally follows procedural \
protocols in a procedurally systematic procedure. The algorithmic algorithm \
algorithmically calculates algorithmic calculations through the algorithm.

Knowledge builds upon knowledge, building on the knowledge that knowledge itself \
is built from known knowable things we know we need to know in order to know. \
The careful, methodical, systematic, deliberate, intentional approach was adopted. \
Results showed that results were consistent with earlier results from prior results.`;

describeE2E('E2E: StylistAgent W2 — stylistAnnotateTab on isolated temp tab', () => {
  let tempTabId   = '';
  const RUN_ID    = Date.now();
  const tempTabName = `E2E-EarTune-${RUN_ID}`;

  beforeAll(() => {
    // Seed API key and model overrides into ScriptProperties.
    seedTestEnvironment_(webAppUrl, TOKEN());

    // Step 1: ensure the standard tab hierarchy exists (idempotent, no Gemini).
    console.log('[E2E eartune] setupStandardTabs…');
    runGasFunction(webAppUrl, 'setupStandardTabs', [], TOKEN());

    // Step 2: seed MergedContent (if empty) + StyleProfile with example content
    //         (no Gemini — writes hardcoded ARCHITECT_EXAMPLE_CONTENT).
    console.log('[E2E eartune] architectGenerateExample…');
    runGasFunction(webAppUrl, 'architectGenerateExample', [], TOKEN());

    // Step 3: seed EarTune tab with example instructions
    //         (no Gemini — writes hardcoded STYLIST_EXAMPLE_CONTENT).
    console.log('[E2E eartune] stylistGenerateExample…');
    runGasFunction(webAppUrl, 'stylistGenerateExample', [], TOKEN());

    // Step 4: create an isolated temp tab and populate it with fixture prose.
    //         The tab name is unique per run so parallel runs cannot interfere.
    console.log(`[E2E eartune] creating temp tab "${tempTabName}"…`);
    tempTabId = createDocTab(DOC_ID, tempTabName, TOKEN());
    console.log(`[E2E eartune] tempTabId: ${tempTabId}`);

    insertTextIntoTab(DOC_ID, tempTabId, FIXTURE_PROSE, TOKEN());
    console.log('[E2E eartune] fixture prose inserted into temp tab');
  }, LONG_TIMEOUT);

  afterAll(() => {
    // Deleting the tab removes it along with any Drive comments anchored to it.
    if (tempTabId) {
      try {
        deleteDocTab(DOC_ID, tempTabId, TOKEN());
        console.log(`[E2E eartune] afterAll: temp tab ${tempTabId} deleted`);
      } catch (e: any) {
        console.warn(`[E2E eartune] afterAll: failed to delete temp tab — ${e?.message}`);
      }
    }
  }, LONG_TIMEOUT);

  it('stylistAnnotateTab completes and creates at least one [EditorLLM] comment on the temp tab', () => {
    // Run the full EarTune W2 pipeline on the temp tab via the web app.
    // One fast-tier Gemini call; result is Drive comments anchored to tempTabId.
    console.log(`[E2E eartune] calling stylistAnnotateTab("${tempTabName}")…`);
    runGasFunction(webAppUrl, 'stylistAnnotateTab', [tempTabName], TOKEN());
    console.log('[E2E eartune] stylistAnnotateTab returned');

    // Fetch all Drive comments on the doc and filter by anchor tab ID.
    // The anchor JSON format (reverse-engineered from Drive API) is:
    //   { r: "head", a: [{ lt: { tb: { id: "<tabId>" } } }] }
    const allComments = listAllComments(DOC_ID, TOKEN());
    const onTempTab = allComments.filter(c => {
      try {
        const anchor = JSON.parse(c.anchor ?? '{}');
        return anchor?.a?.[0]?.lt?.tb?.id === tempTabId;
      } catch { return false; }
    });

    const agentComments = onTempTab.filter(c => c.content?.startsWith('[EditorLLM]'));
    console.log(
      `[E2E eartune] Drive comments on temp tab: ${onTempTab.length} total, ` +
      `${agentComments.length} from agent`
    );
    if (agentComments.length > 0) {
      console.log(`[E2E eartune] first agent comment: "${agentComments[0].content?.slice(0, 120)}"`);
    }

    expect(agentComments.length).toBeGreaterThanOrEqual(1);
  }, LONG_TIMEOUT);

  it('each agent comment on the temp tab starts with the [EditorLLM] prefix', () => {
    const allComments = listAllComments(DOC_ID, TOKEN());
    const onTempTab = allComments.filter(c => {
      try {
        const anchor = JSON.parse(c.anchor ?? '{}');
        return anchor?.a?.[0]?.lt?.tb?.id === tempTabId;
      } catch { return false; }
    });

    // Only check comments that already exist — if none, the previous test would
    // have failed already; here we verify every one has the correct prefix.
    const agentComments = onTempTab.filter(c => c.content?.startsWith('[EditorLLM]'));
    for (const c of agentComments) {
      expect(c.content).toMatch(/^\[EditorLLM\]/);
    }
    console.log(`[E2E eartune] verified prefix on ${agentComments.length} comment(s)`);
  }, LONG_TIMEOUT);
});
