/**
 * Standalone GAS test: do bookmarks and named ranges survive text deletion?
 *
 * Paste this into the Apps Script editor of any Google Doc and run
 * testBookmarkDeletion().  Results appear in View > Logs (Ctrl+Enter).
 * Run cleanupBookmarkDeletionTest() afterwards to remove any leftover named ranges.
 *
 * Tests three deletion scenarios:
 *   A) Programmatic paragraph removal via body.removeChild()
 *   B) Programmatic text clearing via paragraph.clear()  (leaves empty para)
 *   C) Range deletion via body.editAsText().deleteText()
 *
 * NOTE: paragraphs are inserted at position 0 (beginning of body) so the
 * document always has at least one paragraph after the test paragraph is
 * removed — GAS forbids removing the last paragraph in a section.
 */

var BOOKMARK_TEST_RANGE_NAME_ = 'BookmarkDeletionTest_NR';

// ─── helpers ────────────────────────────────────────────────────────────────

function getFirstDocTab_() {
  var doc  = DocumentApp.getActiveDocument();
  var tabs = doc.getTabs();
  if (tabs && tabs.length > 0) return tabs[0].asDocumentTab();
  throw new Error('No tabs found — is this a Google Doc?');
}

function bookmarkExists_(docTab, id) {
  return docTab.getBookmarks().some(function(b) { return b.getId() === id; });
}

function namedRangeExists_(docTab, name) {
  return docTab.getNamedRanges(name).length > 0;
}

function report_(label, bmBefore, nrBefore, bmAfter, nrAfter) {
  Logger.log('');
  Logger.log('── ' + label + ' ──');
  Logger.log('  Bookmark    before: ' + bmBefore + '  after: ' + bmAfter);
  Logger.log('  Named range before: ' + nrBefore + '  after: ' + nrAfter);
  if (!bmAfter) Logger.log('  => Bookmark AUTO-REMOVED by Docs on text deletion.');
  else          Logger.log('  => Bookmark SURVIVED — potential ghost after text edit.');
  if (nrAfter)  Logger.log('  => Named range SURVIVED — must be explicitly deleted.');
  else          Logger.log('  => Named range auto-removed.');
}

// ─── Scenario A: removeChild ─────────────────────────────────────────────────

function scenarioA_removeChild_(docTab) {
  var body = docTab.getBody();
  // Insert at 0 so the document always has content after this paragraph.
  var para = body.insertParagraph(0, '[BookmarkTest-A] removeChild scenario');
  var text = para.editAsText();

  var pos  = docTab.newPosition(text, 0);
  var bm   = docTab.addBookmark(pos);
  var bmId = bm.getId();

  var range = docTab.newRange().addElement(para).build();
  docTab.addNamedRange(BOOKMARK_TEST_RANGE_NAME_ + '_A', range);

  var bmBefore = bookmarkExists_(docTab, bmId);
  var nrBefore = namedRangeExists_(docTab, BOOKMARK_TEST_RANGE_NAME_ + '_A');

  body.removeChild(para);   // ← deletion under test

  var bmAfter = bookmarkExists_(docTab, bmId);
  var nrAfter = namedRangeExists_(docTab, BOOKMARK_TEST_RANGE_NAME_ + '_A');

  report_('A: body.removeChild(para)', bmBefore, nrBefore, bmAfter, nrAfter);
}

// ─── Scenario B: paragraph.clear() ──────────────────────────────────────────

function scenarioB_paragraphClear_(docTab) {
  var body = docTab.getBody();
  var para = body.insertParagraph(0, '[BookmarkTest-B] paragraph.clear() scenario');
  var text = para.editAsText();

  var pos  = docTab.newPosition(text, 0);
  var bm   = docTab.addBookmark(pos);
  var bmId = bm.getId();

  var range = docTab.newRange().addElement(para).build();
  docTab.addNamedRange(BOOKMARK_TEST_RANGE_NAME_ + '_B', range);

  var bmBefore = bookmarkExists_(docTab, bmId);
  var nrBefore = namedRangeExists_(docTab, BOOKMARK_TEST_RANGE_NAME_ + '_B');

  para.clear();   // ← leaves an empty paragraph element in place

  var bmAfter = bookmarkExists_(docTab, bmId);
  var nrAfter = namedRangeExists_(docTab, BOOKMARK_TEST_RANGE_NAME_ + '_B');

  report_('B: para.clear() (empty para remains)', bmBefore, nrBefore, bmAfter, nrAfter);

  try { body.removeChild(para); } catch (_) {}
}

// ─── Scenario C: editAsText().deleteText() ───────────────────────────────────

function scenarioC_deleteText_(docTab) {
  var body = docTab.getBody();
  var para = body.insertParagraph(0, '[BookmarkTest-C] deleteText() scenario');
  var text = para.editAsText();
  var len  = para.getText().length;

  var pos  = docTab.newPosition(text, 0);
  var bm   = docTab.addBookmark(pos);
  var bmId = bm.getId();

  var range = docTab.newRange().addElement(para).build();
  docTab.addNamedRange(BOOKMARK_TEST_RANGE_NAME_ + '_C', range);

  var bmBefore = bookmarkExists_(docTab, bmId);
  var nrBefore = namedRangeExists_(docTab, BOOKMARK_TEST_RANGE_NAME_ + '_C');

  text.deleteText(0, len - 1);   // ← delete all characters, empty para remains

  var bmAfter = bookmarkExists_(docTab, bmId);
  var nrAfter = namedRangeExists_(docTab, BOOKMARK_TEST_RANGE_NAME_ + '_C');

  report_('C: text.deleteText(0, len-1)', bmBefore, nrBefore, bmAfter, nrAfter);

  try { body.removeChild(para); } catch (_) {}
}

// ─── Entry point ─────────────────────────────────────────────────────────────

function testBookmarkDeletion() {
  Logger.log('=== Bookmark + NamedRange deletion survival test ===');
  var docTab = getFirstDocTab_();

  scenarioA_removeChild_(docTab);
  scenarioB_paragraphClear_(docTab);
  scenarioC_deleteText_(docTab);

  Logger.log('');
  Logger.log('=== Done. Run cleanupBookmarkDeletionTest() to remove any leftover named ranges. ===');
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

function cleanupBookmarkDeletionTest() {
  var docTab = getFirstDocTab_();
  var removed = 0;
  ['_A', '_B', '_C'].forEach(function(suffix) {
    var name   = BOOKMARK_TEST_RANGE_NAME_ + suffix;
    var ranges = docTab.getNamedRanges(name);
    ranges.forEach(function(r) { r.remove(); removed++; });
  });
  Logger.log('Cleanup: removed ' + removed + ' named range(s).');
}
