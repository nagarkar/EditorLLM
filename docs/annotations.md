# Annotation System

This document explains how EarTune (and any annotation-capable agent) creates,
stores, and deletes in-document annotations, what can go wrong at each step, and
how to detect and clean up orphaned objects.

---

## What is an annotation?

Each annotation is composed of four objects that are created together and must be
deleted together:

| Object | API | Purpose |
|---|---|---|
| **Named range** | `DocumentApp` | Stores the exact character span that was highlighted. Key: `annotation_<bookmarkId>`. Used to clear highlights precisely at deletion time without scanning the whole tab. |
| **Bookmark** | `DocumentApp` | A cursor-point marker at the start of the matched text. Its ID is the glue linking all four objects: it is embedded in the Drive comment body and used as the named-range key. |
| **Drive comment** | `Drive.Comments` | The visible comment in the Docs/Drive sidebar. Its body contains the bookmark URL (`…#bookmark=<bookmarkId>`) so the deletion path can recover the bookmark ID from the comment alone. |
| **Highlight** | `DocumentApp` | Background colour and bold applied to the matched text span via the named range. Purely visual — its absence does not break creation or deletion. |

The **bookmark ID** is the single cross-reference that ties all four together:

```
Drive comment body:  "…#bookmark=abc123"
                             │
                 ┌───────────┴───────────────────┐
                 ▼                               ▼
  actDoc.getBookmark("abc123")    docTab.getNamedRanges("annotation_abc123")
  → Bookmark object               → NamedRange → exact text span → Highlight
```

---

## Creating an annotation (`annotateOperation_`)

Creation is a three-step sequence. Later steps depend on earlier ones succeeding,
and each step rolls back what was already created before aborting.

### Step 1 — Bookmark + Named range (DocumentApp)

```
findTextOrFallback_(body, op.match_text)
  → pos  = docTab.newPosition(element, startOffset)
  → bm   = docTab.addBookmark(pos)
  → range = docTab.newRange().addElement(…).build()
  → nr   = docTab.addNamedRange("annotation_" + bm.getId(), range)
```

`addBookmark` accepts a **Position** (a cursor point), not a Range — this is a
Google Docs API constraint. The full text span is stored separately in the named
range.

**On failure:** both objects are removed (`bm.remove()`, best-effort) and the
function returns. No Drive comment is created.

### Step 2 — Drive comment (Drive.Comments.create)

The bookmark URL is embedded directly in the comment body:

```
bookmarkUrl = "https://docs.google.com/document/d/<docId>/edit?tab=<tabId>#bookmark=<bmId>"
content     = `[EarTune] "<matchText>": <reason>: <bookmarkUrl>`
Drive.Comments.create({ content, anchor: { r:'head', a:[{lt:{tb:{id:tabId}}}] } }, docId)
```

The `anchor` JSON field is written so the Drive web UI displays the comment
attached to the correct tab (cosmetic only; not used by the deletion path).

`addTabComment_` returns the new comment ID (`string`) on success, or `null` on
failure (Drive error is already logged).

**On failure (null returned):** both the named range and the bookmark are removed
(best-effort) and the function returns. Nothing is orphaned.

### Step 3 — Highlight (DocumentApp)

```
highlightNamedRange_(nr, highlightColor)
  → for each TEXT RangeElement in nr.getRange():
      text.setBackgroundColor(start, end, color)
      text.setBold(start, end, true)
```

**On failure:** the error is logged and the function continues. The comment and
bookmark remain intact. The annotation is functionally complete — the deletion
path can still find and remove all objects even without a visible highlight.

### Summary table

| Step | Succeeds → | Fails → |
|---|---|---|
| 1. Bookmark + named range | proceed to step 2 | best-effort remove bookmark; abort (no Drive call) |
| 2. Drive comment | proceed to step 3 | remove named range + bookmark; abort |
| 3. Highlight | annotation complete | log error; annotation still complete (highlight missing) |

---

## Deleting annotations (`deleteAnnotation_`)

Deletion is called once per `AnnotationRecord`, which is built from the
`Drive.Comments.list` response. Three exclusive branches handle the document-side
cleanup; then a shared block removes the bookmark and Drive comment.

### Branches

**Branch A — new-style annotation** (`bookmarkId` present, `docTab` available):

```
key = "annotation_" + ann.bookmarkId
nrs = docTab.getNamedRanges(key)

if nrs.length > 0:
  clearNamedRangeHighlights_(nrs[0])   // setBackgroundColor(null), setBold(false)
  nrs[0].remove()
  → proceed to shared block

if nrs.length == 0:                    // named range missing (creation bug or old-style)
  needsColorSweep = true               // schedule whole-tab fallback
  → proceed to shared block
  ⚠ Logs: "no named range found for key …"
```

**Branch B — orphan** (`bookmarkId` present, `docTab` is null — tab deleted or renamed):

The `docTab` is needed for `getNamedRanges()`; without it, named-range cleanup is
skipped. `actDoc.getBookmark()` is document-scoped and still works.

```
⚠ Logs: "docTab unavailable for comment …"
→ proceed to shared block (bookmark + Drive comment still removed)
```

**Branch C — very old annotation** (no `bookmarkId` in comment body):

```
needsColorSweep = true                 // schedule whole-tab fallback
⚠ Logs: "comment has no bookmark URL …"
→ proceed to shared block (Drive comment removed; no bookmark to remove)
```

### Shared block (runs after every branch)

```
1. if ann.bookmarkId:
     bm = actDoc.getBookmark(ann.bookmarkId)
     if bm: bm.remove()
     on failure: log error; return { ok: false } — comment left intact for retry

2. Drive.Comments.remove(docId, ann.commentId)
     on failure: log error; ok = false — will retry on next clear
```

Drive comment deletion is always **last** so that if document cleanup fails, the
comment record survives to let the next clear pass retry.

### Color-sweep fallback (`clearTabHighlights_`)

Triggered when `needsColorSweep` is true (Branches B and C, or Branch A with a
missing named range). Scans every paragraph and text run in the tab and clears
any run whose background colour matches `HIGHLIGHT_COLOR`. Expensive — O(paragraphs × text runs).

```
⚠ Logs: "invoking color-sweep fallback for tab …"
```

---

## How to tell which branch was taken (log signals)

All warning/error logs are zero-cost on the happy path (Branch A, named range found).

| Situation | Log fragment to search |
|---|---|
| Branch A happy path | *(silent)* |
| Branch A — named range missing | `"no named range found for key"` |
| Branch B — tab unavailable | `"docTab unavailable for comment"` |
| Branch C — no bookmark URL | `"comment has no bookmark URL"` |
| Color-sweep fallback fired | `"invoking color-sweep fallback"` |
| Step 1 creation failure | `"step 1 (bookmark/namedRange) failed"` |
| Step 2 Drive failure | `"Drive comment failed"` |
| Step 3 highlight failure | `"step 3 (highlight) failed"` |
| Named-range clear threw | `"named-range clear failed"` |
| Bookmark remove threw | `"bookmark remove failed"` |
| Drive delete failed | `"Drive comment delete failed"` |

The summary `Tracer.info` at the end of each clear pass reports totals:
`comments deleted`, `named ranges removed`, `bookmarks removed`,
`highlight runs cleared`. Use these for quick sanity checks.

---

## Orphaned objects

An orphan is any annotation component that survives without its partner objects.
The table below lists every cause and the expected observable state:

| Orphan type | When it happens | Observable symptom |
|---|---|---|
| **Drive comment only** | Step 1 or 2 aborted after the comment was already created (impossible by design — Drive comment is step 2; a step-1 abort means no comment was made). In practice: manual comment deletion in Docs UI leaves the bookmark + named range in the document. | Highlight + named range persist; no Drive comment. Next clear pass will not find the annotation (no matching comment → no `deleteAnnotation_` call). Highlight stays forever unless a color sweep is run manually. |
| **Named range + bookmark, no comment** | Step 2 Drive failure rolled back both — this is the correct outcome, no orphan. | N/A (design prevents this). |
| **Highlight only (no named range)** | Step 1 partially succeeded: `addBookmark` succeeded, `addNamedRange` threw, step-3 highlight ran on a different code path (not possible — highlight uses the named range). | N/A (highlight is applied via the named range; if the named range was never created, no highlight was applied either). |
| **Bookmark + named range, no comment** | Step 2 failed AND rollback also failed (extremely rare — two consecutive failures). | Phantom bookmark and named range in document. Unreachable by the deletion path (which is comment-driven). Must be removed manually. |
| **Named range missing at delete time** | Named range existed at creation but was subsequently deleted by the user (or a Docs undo that crossed a session boundary). | `deleteAnnotation_` enters the "no named range found" warning path; schedules color sweep; bookmark and comment still get cleaned up correctly. Highlight cleared by the fallback sweep. |
| **Bookmark missing at delete time** | User deleted the bookmark manually, or a Docs undo removed it. | `actDoc.getBookmark()` returns null; `deleteAnnotation_` skips bookmark removal and proceeds to Drive comment deletion. Clean outcome — no orphan. |
| **Drive comment survives after clear** | `Drive.Comments.remove` threw (transient Drive error); `deleteAnnotation_` returns `ok: false`. | Comment persists; the next clear-pass re-lists it and retries deletion. Self-healing. |

---

## Cleaning up orphans

### Highlights without a Drive comment

These cannot be removed by the normal clear path (which is comment-driven).
Options:

1. **Run a manual color sweep** — call `CollaborationService.clearTabHighlights(tabName)`
   from the Apps Script editor. This scans the entire tab and clears every text
   run whose background colour matches `HIGHLIGHT_COLOR`.

2. **Use "Clear All Annotations"** — if `clearAgentAnnotationsBulk_` finds
   old-style comments (Branch C) or missing named ranges (Branch A fallback), it
   automatically invokes `clearTabHighlights_` per affected tab.

3. **Manual formatting** — select the highlighted text in Google Docs and use
   Format → Text → Clear formatting.

### Bookmarks or named ranges without a Drive comment

These are unreachable by the normal clear path. They are harmless (invisible to
readers) but accumulate in the document's internal name registry.

To remove them programmatically, run a script in the Apps Script editor:

```javascript
// Remove all named ranges whose key starts with "annotation_"
const doc = DocumentApp.getActiveDocument();
for (const tab of doc.getTabs()) {
  const dt = tab.asDocumentTab();
  for (const nr of dt.getNamedRanges()) {
    if (nr.getName().startsWith('annotation_')) nr.remove();
  }
}
// Note: there is no bulk API to list all bookmarks; individual bookmarks
// can only be removed if you know their IDs.
```

### Self-healing properties

The deletion path is designed to be **retried safely**:
- The collect phase re-reads `Drive.Comments.list` on each run, so any comment
  that survived a previous failed deletion attempt will be picked up again.
- All document-side removals are attempted before the Drive comment is deleted,
  ensuring the comment always survives as the authoritative retry record.
- `needsColorSweep` is scoped to each clear invocation; it never causes a sweep
  for tabs that had only clean (named-range) annotations.
