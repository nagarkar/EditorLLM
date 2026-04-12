// ============================================================
// CollaborationService integration tests — real Drive/Docs REST API calls.
//
// What is tested:
//   - Comment creation: anchor format, AGENT_COMMENT_PREFIX, Drive accepts the payload
//   - Comment listing: the created comment appears and is parseable
//   - clearAgentAnnotations behaviour:
//       • deletes agent-prefixed comments on the target tab
//       • preserves user comments on the same tab
//       • preserves agent comments on a different tab (if doc has ≥2 tabs)
//   - Error handling: invalid token throws a descriptive error
//
// Requirements:
//   GOOGLE_DOC_ID  — ID of a test Google Doc (from the URL)
//   GOOGLE_TOKEN   — valid OAuth2 access token (from ~/.clasprc.json after clasp login)
//
// These are set by running: bash src/__tests__/integration/setup-test-env.sh
// Tests are automatically skipped when either variable is absent.
//
// Timeout: 30 s per test (Drive REST is fast; not a model call).
// ============================================================

import { INTEGRATION_CONFIG } from './config';
import {
  fetchTabs,
  createComment,
  listAllComments,
  deleteComment,
  getComment,
  DriveComment,
} from './helpers/drive';

const TIMEOUT = 30000;
const AGENT_COMMENT_PREFIX = '[EditorLLM] ';

// ── Credential guard — skip entire suite when credentials are absent ──────────

const { googleDocId: DOC_ID, googleToken: TOKEN } = INTEGRATION_CONFIG;
const hasCredentials = !!DOC_ID && !!TOKEN;
const suite = hasCredentials ? describe : describe.skip;

// ── Shared state: tab IDs resolved once in beforeAll ─────────────────────────

let primaryTabId   = '';
let secondaryTabId = '';  // '' when doc has only one tab

/** IDs of every comment created during this test run — deleted in afterAll. */
const createdCommentIds: string[] = [];

function trackComment(id: string): string {
  createdCommentIds.push(id);
  return id;
}

// ── Inline clearAgentAnnotations logic (mirrors CollaborationService.ts) ─────
//
// This runs the exact same loop as the production code, but calls the Drive
// REST API directly instead of the GAS Advanced Service.  If this logic
// diverges from CollaborationService, the integration test must be updated.

function clearAgentAnnotations(docId: string, tabId: string, token: string): number {
  let deleted = 0;
  const all = listAllComments(docId, token);
  for (const comment of all) {
    let anchorTabId: string | undefined;
    try {
      const anchor = JSON.parse(comment.anchor ?? '{}');
      anchorTabId = anchor?.a?.[0]?.lt?.tb?.id;
    } catch {
      continue;
    }
    if (anchorTabId !== tabId) continue;
    if (!comment.content.startsWith(AGENT_COMMENT_PREFIX)) continue;
    deleteComment(docId, comment.id, token);
    deleted++;
  }
  return deleted;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

suite('CollaborationService — Drive REST integration', () => {

  // ── Setup / teardown ───────────────────────────────────────────────────────

  beforeAll(() => {
    const tabs = fetchTabs(DOC_ID, TOKEN);
    if (tabs.length === 0) {
      throw new Error(
        `Integration test setup failed: document "${DOC_ID}" has no tabs. ` +
        `Ensure GOOGLE_DOC_ID points to a multi-tab Google Doc.`
      );
    }
    primaryTabId   = tabs[0].tabId;
    secondaryTabId = tabs.length > 1 ? tabs[1].tabId : '';
    console.log(
      `[integration] doc=${DOC_ID} ` +
      `primaryTab=${primaryTabId} secondaryTab=${secondaryTabId || '(only one tab)'}`
    );
  }, TIMEOUT);

  afterAll(() => {
    // Best-effort cleanup — delete any comments left behind by failed tests.
    // 404 = already deleted by the test itself (expected). Anything else is logged.
    for (const id of createdCommentIds) {
      try {
        deleteComment(DOC_ID, id, TOKEN);
      } catch (e: any) {
        if (!e?.message?.includes('404')) {
          console.warn(`[afterAll cleanup] Failed to delete comment ${id}: ${e?.message}`);
        }
      }
    }
  }, TIMEOUT * 2);

  // ── Comment creation ───────────────────────────────────────────────────────

  describe('comment creation', () => {

    it('creates a comment and Drive returns a valid ID', () => {
      const id = trackComment(
        createComment(DOC_ID, primaryTabId, `${AGENT_COMMENT_PREFIX}creation test`, TOKEN)
      );

      expect(typeof id).toBe('string');
      expect(id.trim().length).toBeGreaterThan(0);
    }, TIMEOUT);

    it('created comment has content prefixed with AGENT_COMMENT_PREFIX', () => {
      const id = trackComment(
        createComment(DOC_ID, primaryTabId, `${AGENT_COMMENT_PREFIX}prefix check`, TOKEN)
      );

      const comment = getComment(DOC_ID, id, TOKEN);
      expect(comment.content.startsWith(AGENT_COMMENT_PREFIX)).toBe(true);
    }, TIMEOUT);

    it('comment body after the prefix matches what was sent', () => {
      const body = 'Born-rule exponent must be 2, not 3.';
      const id = trackComment(
        createComment(DOC_ID, primaryTabId, AGENT_COMMENT_PREFIX + body, TOKEN)
      );

      const comment = getComment(DOC_ID, id, TOKEN);
      expect(comment.content).toBe(AGENT_COMMENT_PREFIX + body);
    }, TIMEOUT);

    it('anchor is stored as a JSON string by Drive', () => {
      const id = trackComment(
        createComment(DOC_ID, primaryTabId, `${AGENT_COMMENT_PREFIX}anchor test`, TOKEN)
      );

      const comment = getComment(DOC_ID, id, TOKEN);
      expect(() => JSON.parse(comment.anchor)).not.toThrow();
    }, TIMEOUT);

    it('anchor tab ID in Drive response matches the tab we targeted', () => {
      const id = trackComment(
        createComment(DOC_ID, primaryTabId, `${AGENT_COMMENT_PREFIX}anchor tab check`, TOKEN)
      );

      const comment = getComment(DOC_ID, id, TOKEN);
      const anchor  = JSON.parse(comment.anchor);
      expect(anchor?.a?.[0]?.lt?.tb?.id).toBe(primaryTabId);
    }, TIMEOUT);

    it('anchor contains r:"head"', () => {
      const id = trackComment(
        createComment(DOC_ID, primaryTabId, `${AGENT_COMMENT_PREFIX}r-head check`, TOKEN)
      );

      const comment = getComment(DOC_ID, id, TOKEN);
      const anchor  = JSON.parse(comment.anchor);
      expect(anchor.r).toBe('head');
    }, TIMEOUT);

  });

  // ── Comment listing ────────────────────────────────────────────────────────

  describe('comment listing', () => {

    it('a freshly created comment appears in listAllComments', () => {
      const id = trackComment(
        createComment(DOC_ID, primaryTabId, `${AGENT_COMMENT_PREFIX}list check`, TOKEN)
      );

      const all = listAllComments(DOC_ID, TOKEN);
      const ids = all.map((c: DriveComment) => c.id);
      expect(ids).toContain(id);
    }, TIMEOUT);

    it('agent comments can be filtered from the list by prefix', () => {
      const id = trackComment(
        createComment(DOC_ID, primaryTabId, `${AGENT_COMMENT_PREFIX}filter test`, TOKEN)
      );

      const all    = listAllComments(DOC_ID, TOKEN);
      const agents = all.filter((c: DriveComment) => c.content.startsWith(AGENT_COMMENT_PREFIX));
      const ids    = agents.map((c: DriveComment) => c.id);
      expect(ids).toContain(id);
    }, TIMEOUT);

    it('agent comments can be filtered by target tab ID from their anchor', () => {
      const id = trackComment(
        createComment(DOC_ID, primaryTabId, `${AGENT_COMMENT_PREFIX}tab filter`, TOKEN)
      );

      const all        = listAllComments(DOC_ID, TOKEN);
      const onThisTab  = all.filter((c: DriveComment) => {
        try {
          const anchor = JSON.parse(c.anchor ?? '{}');
          return anchor?.a?.[0]?.lt?.tb?.id === primaryTabId;
        } catch {
          return false;
        }
      });
      expect(onThisTab.map((c: DriveComment) => c.id)).toContain(id);
    }, TIMEOUT);

  });

  // ── clearAgentAnnotations behaviour ───────────────────────────────────────

  describe('clearAgentAnnotations', () => {

    it('deletes agent comments on the target tab', () => {
      const agentId = trackComment(
        createComment(DOC_ID, primaryTabId, `${AGENT_COMMENT_PREFIX}to be deleted`, TOKEN)
      );

      clearAgentAnnotations(DOC_ID, primaryTabId, TOKEN);

      const remaining = listAllComments(DOC_ID, TOKEN).map((c: DriveComment) => c.id);
      expect(remaining).not.toContain(agentId);
    }, TIMEOUT);

    it('preserves user comments on the same tab', () => {
      // Create a "user" comment — no AGENT_COMMENT_PREFIX
      const userId = trackComment(
        createComment(DOC_ID, primaryTabId, 'Author note — should not be deleted', TOKEN)
      );

      clearAgentAnnotations(DOC_ID, primaryTabId, TOKEN);

      const remaining = listAllComments(DOC_ID, TOKEN).map((c: DriveComment) => c.id);
      expect(remaining).toContain(userId);

      // Explicit cleanup of the user comment we created
      deleteComment(DOC_ID, userId, TOKEN);
      // Remove from tracking so afterAll doesn't try to delete it again
      const idx = createdCommentIds.indexOf(userId);
      if (idx !== -1) createdCommentIds.splice(idx, 1);
    }, TIMEOUT);

    it('does not delete agent comments anchored to a different tab', () => {
      if (!secondaryTabId) {
        console.log('[integration] skipping cross-tab test — doc has only one tab');
        return;
      }

      const agentOnOtherTab = trackComment(
        createComment(DOC_ID, secondaryTabId, `${AGENT_COMMENT_PREFIX}on secondary tab`, TOKEN)
      );

      // Clear only the primary tab
      clearAgentAnnotations(DOC_ID, primaryTabId, TOKEN);

      const remaining = listAllComments(DOC_ID, TOKEN).map((c: DriveComment) => c.id);
      expect(remaining).toContain(agentOnOtherTab);
    }, TIMEOUT);

    it('returns the correct count of deleted comments', () => {
      trackComment(createComment(DOC_ID, primaryTabId, `${AGENT_COMMENT_PREFIX}del-1`, TOKEN));
      trackComment(createComment(DOC_ID, primaryTabId, `${AGENT_COMMENT_PREFIX}del-2`, TOKEN));
      // User comment — should NOT be counted
      const userId = trackComment(
        createComment(DOC_ID, primaryTabId, 'user comment — not counted', TOKEN)
      );

      const deleted = clearAgentAnnotations(DOC_ID, primaryTabId, TOKEN);

      expect(deleted).toBeGreaterThanOrEqual(2);

      // Clean up the user comment
      deleteComment(DOC_ID, userId, TOKEN);
      const idx = createdCommentIds.indexOf(userId);
      if (idx !== -1) createdCommentIds.splice(idx, 1);
    }, TIMEOUT);

  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe('error handling', () => {

    it('throws a descriptive error when the OAuth token is invalid', () => {
      expect(() =>
        listAllComments(DOC_ID, 'INVALID_TOKEN_FOR_TESTING')
      ).toThrow(/Drive\/Docs API error/);
    }, TIMEOUT);

    it('throws a descriptive error when the document ID is invalid', () => {
      expect(() =>
        listAllComments('INVALID_DOC_ID_FOR_TESTING', TOKEN)
      ).toThrow(/Drive\/Docs API error/);
    }, TIMEOUT);

    it('throws a descriptive error when creating a comment with an invalid token', () => {
      expect(() =>
        createComment(DOC_ID, primaryTabId, 'test', 'INVALID_TOKEN')
      ).toThrow(/Drive\/Docs API error/);
    }, TIMEOUT);

  });

});

// ── Suite skipped — explain why ───────────────────────────────────────────────

if (!hasCredentials) {
  describe('CollaborationService — Drive REST integration (SKIPPED)', () => {
    it('requires GOOGLE_DOC_ID and GOOGLE_TOKEN — run setup-test-env.sh to configure', () => {
      console.log(
        '\n  [collaboration.integration] Tests skipped.\n' +
        '  Set GOOGLE_DOC_ID and GOOGLE_TOKEN by running:\n' +
        '    bash src/__tests__/integration/setup-test-env.sh\n' +
        '  Also ensure the Drive and Docs APIs are enabled in your GCP project.\n'
      );
      expect(true).toBe(true);
    });
  });
}
