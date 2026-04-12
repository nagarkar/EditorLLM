// ============================================================
// Drive and Docs REST API helpers for integration tests.
//
// Provides synchronous HTTP wrappers (via xmlhttprequest) for the
// Drive v3 Comments API and the Docs v1 document structure API.
//
// These are the same REST endpoints that CollaborationService targets
// via the GAS Advanced Service — this file lets integration tests
// exercise those endpoints directly from Node.js.
//
// This is test infrastructure only. Production code uses GAS services.
// ============================================================

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const DOCS_BASE  = 'https://docs.googleapis.com/v1';

// ── Generic synchronous HTTP caller ──────────────────────────────────────────

function callApi(
  method: string,
  url: string,
  token: string,
  body?: object
): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { XMLHttpRequest } = require('xmlhttprequest');
  const xhr = new XMLHttpRequest();
  xhr.open(method, url, false); // false = synchronous
  xhr.setRequestHeader('Authorization', `Bearer ${token}`);
  if (body !== undefined) {
    xhr.setRequestHeader('Content-Type', 'application/json');
  }
  xhr.send(body !== undefined ? JSON.stringify(body) : null);

  // DELETE returns 204 No Content — treat empty body as success
  if (xhr.status === 204) return null;

  const raw: string = xhr.responseText;
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Drive/Docs API response is not valid JSON (HTTP ${xhr.status}): ${raw.slice(0, 300)}`
    );
  }

  if (parsed?.error) {
    throw new Error(
      `Drive/Docs API error ${parsed.error.code ?? xhr.status}: ${parsed.error.message ?? raw.slice(0, 200)}`
    );
  }

  return parsed;
}

// ── Docs REST API — tab structure ─────────────────────────────────────────────

export interface TabInfo {
  title: string;
  tabId: string;
}

/**
 * Fetches the flat list of all tabs (title → tabId) for the given document.
 * Uses a fields mask so only tab metadata is returned — no body content.
 */
export function fetchTabs(docId: string, token: string): TabInfo[] {
  const fields = 'tabs(tabProperties,childTabs(tabProperties,childTabs(tabProperties)))';
  const url = `${DOCS_BASE}/documents/${docId}?includeTabsContent=true&fields=${encodeURIComponent(fields)}`;
  const doc = callApi('GET', url, token);

  const result: TabInfo[] = [];
  function collect(tabs: any[]): void {
    for (const t of tabs ?? []) {
      const p = t.tabProperties;
      if (p?.title && p?.tabId) result.push({ title: p.title, tabId: p.tabId });
      collect(t.childTabs ?? []);
    }
  }
  collect(doc.tabs ?? []);
  return result;
}

// ── Drive v3 Comments API ─────────────────────────────────────────────────────

export interface DriveComment {
  id:      string;
  content: string;
  anchor:  string;
}

export interface ListCommentsResult {
  comments:      DriveComment[];
  nextPageToken?: string;
}

/**
 * Creates a Drive comment anchored to the given tab.
 * Returns the new comment's ID.
 */
export function createComment(
  docId:   string,
  tabId:   string,
  content: string,
  token:   string
): string {
  const url = `${DRIVE_BASE}/files/${docId}/comments?fields=id`;
  const anchor = JSON.stringify({
    r: 'head',
    a: [{ lt: { tb: { id: tabId } } }],
  });
  const result = callApi('POST', url, token, { content, anchor });
  if (!result?.id) {
    throw new Error(`createComment: Drive did not return a comment ID. Response: ${JSON.stringify(result)}`);
  }
  return result.id as string;
}

/**
 * Lists Drive comments for the document (one page).
 * Pass nextPageToken to continue from a previous page.
 */
export function listComments(
  docId:      string,
  token:      string,
  pageToken?: string
): ListCommentsResult {
  const fields = encodeURIComponent('nextPageToken,comments(id,content,anchor)');
  let url = `${DRIVE_BASE}/files/${docId}/comments?pageSize=100&fields=${fields}&includeDeleted=false`;
  if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
  const result = callApi('GET', url, token);
  return {
    comments:      result.comments ?? [],
    nextPageToken: result.nextPageToken,
  };
}

/**
 * Lists ALL Drive comments for the document, following pagination automatically.
 */
export function listAllComments(docId: string, token: string): DriveComment[] {
  const all: DriveComment[] = [];
  let pageToken: string | undefined;
  do {
    const page = listComments(docId, token, pageToken);
    all.push(...page.comments);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return all;
}

/**
 * Deletes a Drive comment by ID.
 * Throws if the API returns an error (including 404 — comment not found).
 */
export function deleteComment(docId: string, commentId: string, token: string): void {
  const url = `${DRIVE_BASE}/files/${docId}/comments/${commentId}`;
  callApi('DELETE', url, token);
}

/**
 * Retrieves a single Drive comment by ID.
 * Useful for verifying a just-created comment.
 */
export function getComment(docId: string, commentId: string, token: string): DriveComment {
  const fields = encodeURIComponent('id,content,anchor');
  const url = `${DRIVE_BASE}/files/${docId}/comments/${commentId}?fields=${fields}`;
  return callApi('GET', url, token) as DriveComment;
}

// ── Drive comment with replies ────────────────────────────────────────────────

export interface DriveReply {
  id:      string;
  content: string;
  author?: { displayName: string };
}

export interface DriveCommentWithReplies extends DriveComment {
  replies: DriveReply[];
  resolved: boolean;
}

/**
 * Retrieves a comment with its full reply thread.
 * Used by E2E tests to verify the agent posted a reply.
 */
export function getCommentWithReplies(
  docId: string,
  commentId: string,
  token: string
): DriveCommentWithReplies {
  const fields = encodeURIComponent(
    'id,content,anchor,resolved,replies(id,content,author/displayName)'
  );
  const url = `${DRIVE_BASE}/files/${docId}/comments/${commentId}?fields=${fields}&includeDeleted=false`;
  return callApi('GET', url, token) as DriveCommentWithReplies;
}

// ── Docs REST API — tab management ────────────────────────────────────────────
//
// Used by E2E tests to create and tear down isolated test tabs.

/**
 * Creates a new tab in the document using the Docs batchUpdate API.
 * Returns the new tab's ID.
 *
 * The correct request field is `addDocumentTab` (not `insertTab`).
 * The batchUpdate reply may omit the tabId, so we fall back to a fresh
 * GET of the document's tab list and search by title — same pattern used
 * in DocOps.createTabViaApi_ on the GAS side.
 */
export function createDocTab(docId: string, title: string, token: string): string {
  const url = `${DOCS_BASE}/documents/${docId}:batchUpdate`;
  const result = callApi('POST', url, token, {
    requests: [{ addDocumentTab: { tabProperties: { title } } }],
  });

  // Fast path: tabId present in batchUpdate reply.
  // The REST API returns replies[0].addDocumentTab.tabProperties.tabId
  // (no intermediate .tab level, unlike the Apps Script Advanced Service schema).
  let tabId = result?.replies?.[0]?.addDocumentTab?.tabProperties?.tabId as string | undefined;

  if (!tabId) {
    // Fallback: re-fetch the document's tab tree and locate by title
    const doc = callApi('GET', `${DOCS_BASE}/documents/${docId}`, token) as any;
    function findInTabs(tabs: any[]): string | undefined {
      for (const tab of (tabs ?? [])) {
        if (tab?.tabProperties?.title === title) return tab?.tabProperties?.tabId as string;
        const child = findInTabs(tab?.childTabs ?? []);
        if (child) return child;
      }
      return undefined;
    }
    tabId = findInTabs(doc?.tabs ?? []);
  }

  if (!tabId) {
    throw new Error(
      `createDocTab: could not retrieve tabId after creation (title="${title}"). ` +
      `Response: ${JSON.stringify(result)}`
    );
  }
  return tabId;
}

/**
 * Deletes a tab from the document.
 * 404 errors are silently ignored (already deleted = success).
 */
export function deleteDocTab(docId: string, tabId: string, token: string): void {
  const url = `${DOCS_BASE}/documents/${docId}:batchUpdate`;
  try {
    callApi('POST', url, token, { requests: [{ deleteTab: { tabId } }] });
  } catch (e: any) {
    if (e?.message?.includes('400') || e?.message?.includes('404')) return; // already gone
    throw e;
  }
}

/**
 * Inserts text at the beginning of a tab's body.
 * Requires the Docs API `documents` scope.
 */
export function insertTextIntoTab(
  docId:  string,
  tabId:  string,
  text:   string,
  token:  string
): void {
  const url = `${DOCS_BASE}/documents/${docId}:batchUpdate`;
  callApi('POST', url, token, {
    requests: [{ insertText: { text, location: { index: 1, tabId } } }],
  });
}
