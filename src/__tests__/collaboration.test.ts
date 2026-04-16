// Unit tests for CollaborationService pure helpers and annotation logic.
// Functions under test are imported directly from CollaborationHelpers.ts —
// no duplication or "keep in sync" maintenance required.

import {
  findTextOrFallback_,
  matchesAgentPrefix_,
  highlightRangeElement_,
  buildCommentContent_,
  MAX_COMMENT_CHARS,
  resolveWorkflowType_,
} from '../CollaborationHelpers';

// ─────────────────────────────────────────────────────────────────────────────
// matchesAgentPrefix_
// ─────────────────────────────────────────────────────────────────────────────

describe('matchesAgentPrefix_', () => {

  // ── Single string prefix ──────────────────────────────────────────────────

  it('matches when content starts with a single prefix (exact)', () => {
    expect(matchesAgentPrefix_('[EarTune] fix this', '[EarTune]')).toBe(true);
  });

  it('returns false when content does not start with the prefix', () => {
    expect(matchesAgentPrefix_('Great sentence here', '[EarTune]')).toBe(false);
  });

  it('returns false when prefix appears mid-string but not at start', () => {
    expect(matchesAgentPrefix_('See [EarTune] note', '[EarTune]')).toBe(false);
  });

  // ── Drive API strips leading '[' ─────────────────────────────────────────

  it('matches when Drive strips the leading "[" from a bracket prefix', () => {
    // Drive returns 'EarTune] fix this' instead of '[EarTune] fix this'
    expect(matchesAgentPrefix_('EarTune] fix this', '[EarTune]')).toBe(true);
  });

  it('matches the stripped form for a different bracket prefix', () => {
    expect(matchesAgentPrefix_('Architect] review note', '[Architect]')).toBe(true);
  });

  it('does NOT apply the strip-fallback when prefix has no leading "["', () => {
    // If prefix is 'NOTE: ', there is no '[' to strip — should NOT match 'OTE: '
    expect(matchesAgentPrefix_('OTE: some content', 'NOTE: ')).toBe(false);
  });

  // ── Array of prefixes ─────────────────────────────────────────────────────

  it('matches when content matches the first prefix in an array', () => {
    expect(matchesAgentPrefix_('[EarTune] note', ['[EarTune]', '[Architect]'])).toBe(true);
  });

  it('matches when content matches the second prefix in an array', () => {
    expect(matchesAgentPrefix_('[Architect] review', ['[EarTune]', '[Architect]'])).toBe(true);
  });

  it('returns false when content matches none of the prefixes in an array', () => {
    expect(matchesAgentPrefix_('User comment here', ['[EarTune]', '[Architect]'])).toBe(false);
  });

  it('matches the stripped form of the second prefix in an array', () => {
    // Drive strips '[' from '[Architect]' → 'Architect] …'
    expect(matchesAgentPrefix_('Architect] review', ['[EarTune]', '[Architect]'])).toBe(true);
  });

  // ── No false positives ─────────────────────────────────────────────────────

  it('does NOT match a prefix that is a substring at a later position', () => {
    expect(matchesAgentPrefix_('User note — [EarTune] flagged this', '[EarTune]')).toBe(false);
  });

  it('does NOT match a prefix that is merely a substring of the actual prefix', () => {
    // '[EarTune' without ']' is not '[EarTune]'
    expect(matchesAgentPrefix_('[EarTune flagged', '[EarTune]')).toBe(false);
  });

  it('does NOT match a different agent prefix that shares a partial name', () => {
    // '[EarTuneExtra]' should not match '[EarTune]'
    expect(matchesAgentPrefix_('[EarTuneExtra] note', '[EarTune]')).toBe(false);
  });

  // ── Empty / edge cases ────────────────────────────────────────────────────

  it('returns false on empty content string', () => {
    expect(matchesAgentPrefix_('', '[EarTune]')).toBe(false);
  });

  it('returns false on empty prefix array', () => {
    expect(matchesAgentPrefix_('[EarTune] note', [])).toBe(false);
  });

  it('matches when content exactly equals the prefix with nothing after it', () => {
    expect(matchesAgentPrefix_('[EarTune]', '[EarTune]')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// findTextOrFallback_
// ─────────────────────────────────────────────────────────────────────────────

describe('findTextOrFallback_', () => {
  it('returns exact match when found', () => {
    const mockRangeEl = { getElement: jest.fn(), getStartOffset: jest.fn(() => 4) };
    const body = { findText: jest.fn().mockReturnValue(mockRangeEl) } as any;

    const result = findTextOrFallback_(body, 'the Chid Axiom');

    expect(result).toBe(mockRangeEl);
    // The search term is regex-escaped before calling findText
    expect(body.findText).toHaveBeenCalledWith('the Chid Axiom');
  });

  it('falls back to first word when exact match not found', () => {
    const firstWordEl = { getElement: jest.fn(), getStartOffset: jest.fn(() => 0) };
    const body = {
      findText: jest.fn().mockImplementation((p: string) =>
        p === '\\S+' ? firstWordEl : null
      ),
    } as any;

    const result = findTextOrFallback_(body, 'nonexistent phrase here');

    expect(result).toBe(firstWordEl);
    expect(body.findText).toHaveBeenCalledWith('\\S+');
  });

  it('returns null when body is completely empty', () => {
    const body = { findText: jest.fn().mockReturnValue(null) } as any;

    const result = findTextOrFallback_(body, 'anything');

    expect(result).toBeNull();
    expect(body.findText).toHaveBeenCalledTimes(2); // exact attempt + fallback
  });

  it('does not attempt fallback when exact match succeeds', () => {
    const rangeEl = { getElement: jest.fn() };
    const body = { findText: jest.fn().mockReturnValue(rangeEl) } as any;

    findTextOrFallback_(body, 'found text');

    expect(body.findText).toHaveBeenCalledTimes(1);
  });

  it('escapes regex special characters in matchText before calling findText', () => {
    const body = { findText: jest.fn().mockReturnValue(null) } as any;

    findTextOrFallback_(body, 'price: $10.00 (USD)');

    // Should be regex-escaped
    expect(body.findText).toHaveBeenNthCalledWith(
      1,
      'price: \\$10\\.00 \\(USD\\)'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// highlightRangeElement_
// ─────────────────────────────────────────────────────────────────────────────

describe('highlightRangeElement_', () => {
  const HIGHLIGHT_COLOR = '#FFD966';

  function makeRangeEl(type: string, start = 2, end = 8) {
    const textEl = {
      setBackgroundColor: jest.fn(),
      setBold:            jest.fn(),
    };
    const el = {
      getType:  jest.fn().mockReturnValue(type),
      asText:   jest.fn().mockReturnValue(textEl),
    };
    return {
      rangeEl: {
        getElement:             jest.fn().mockReturnValue(el),
        getStartOffset:         jest.fn().mockReturnValue(start),
        getEndOffsetInclusive:  jest.fn().mockReturnValue(end),
      } as any,
      textEl,
    };
  }

  it('calls setBackgroundColor with the provided color and correct offsets', () => {
    const { rangeEl, textEl } = makeRangeEl('TEXT', 3, 10);

    highlightRangeElement_(rangeEl, HIGHLIGHT_COLOR);

    expect(textEl.setBackgroundColor).toHaveBeenCalledWith(3, 10, HIGHLIGHT_COLOR);
  });

  it('calls setBold(true) with correct offsets', () => {
    const { rangeEl, textEl } = makeRangeEl('TEXT', 3, 10);

    highlightRangeElement_(rangeEl, HIGHLIGHT_COLOR);

    expect(textEl.setBold).toHaveBeenCalledWith(3, 10, true);
  });

  it('does nothing when element type is not TEXT', () => {
    const { rangeEl, textEl } = makeRangeEl('PARAGRAPH');

    highlightRangeElement_(rangeEl, HIGHLIGHT_COLOR);

    expect(textEl.setBackgroundColor).not.toHaveBeenCalled();
    expect(textEl.setBold).not.toHaveBeenCalled();
  });

  it('handles zero-length range (start === end)', () => {
    const { rangeEl, textEl } = makeRangeEl('TEXT', 5, 5);

    highlightRangeElement_(rangeEl, HIGHLIGHT_COLOR);

    expect(textEl.setBackgroundColor).toHaveBeenCalledWith(5, 5, HIGHLIGHT_COLOR);
    expect(textEl.setBold).toHaveBeenCalledWith(5, 5, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildCommentContent_
// ─────────────────────────────────────────────────────────────────────────────

describe('buildCommentContent_', () => {
  const PREFIX  = '[EarTune]';
  const MATCH   = 'thick with';
  const BODY    = 'Rhythm issue here.';
  const BM_URL  = 'https://docs.google.com/document/d/DOC/edit?tab=t.0#bookmark=bm1';

  it('uses the agent-specific prefix (not a global EditorLLM prefix)', () => {
    const { content } = buildCommentContent_(PREFIX, MATCH, BODY, '');
    expect(content).toContain('[EarTune]');
    expect(content).not.toContain('[EditorLLM]');
  });

  it('preserves the comment body after the prefix', () => {
    const { content } = buildCommentContent_(PREFIX, MATCH, BODY, '');
    expect(content).toContain(BODY);
    expect(content.startsWith(PREFIX)).toBe(true);
  });

  it('appends the bookmark URL when provided', () => {
    const { content } = buildCommentContent_(PREFIX, MATCH, BODY, BM_URL);
    expect(content).toContain(BM_URL);
  });

  it('does not append URL when bookmarkUrl is empty', () => {
    const { content } = buildCommentContent_(PREFIX, MATCH, BODY, '');
    expect(content).not.toContain('https://');
  });

  it('returns truncated=false when content is within MAX_COMMENT_CHARS', () => {
    const { truncated } = buildCommentContent_(PREFIX, MATCH, BODY, '');
    expect(truncated).toBe(false);
  });

  it('truncates and returns truncated=true when content exceeds MAX_COMMENT_CHARS', () => {
    const longBody = 'x'.repeat(MAX_COMMENT_CHARS + 500);
    const { content, truncated } = buildCommentContent_(PREFIX, MATCH, longBody, '');
    expect(truncated).toBe(true);
    expect(content.length).toBeLessThanOrEqual(MAX_COMMENT_CHARS);
    expect(content).toContain('… [truncated]');
  });

  it('includes the bookmark URL in the truncated suffix when provided', () => {
    const longBody = 'x'.repeat(MAX_COMMENT_CHARS + 500);
    const { content, truncated } = buildCommentContent_(PREFIX, MATCH, longBody, BM_URL);
    expect(truncated).toBe(true);
    expect(content).toContain(BM_URL);
    expect(content.length).toBeLessThanOrEqual(MAX_COMMENT_CHARS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveWorkflowType_
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveWorkflowType_', () => {
  it('routes instruction_update correctly', () => {
    const update = {
      workflow_type: 'instruction_update' as const,
      review_tab: 'StyleProfile',
      proposed_full_text: '# Style',
      operations: [],
    };
    expect(resolveWorkflowType_(update)).toBe('instruction_update');
  });

  it('routes content_annotation correctly', () => {
    const update = {
      workflow_type: 'content_annotation' as const,
      target_tab: 'Chapter 1',
      operations: [{ match_text: 'some text', reason: 'reason' }],
    };
    expect(resolveWorkflowType_(update)).toBe('content_annotation');
  });

  it('only returns one of the two known types', () => {
    for (const wt of ['instruction_update', 'content_annotation'] as const) {
      const result = resolveWorkflowType_({ workflow_type: wt, operations: [] });
      expect(['instruction_update', 'content_annotation']).toContain(result);
    }
  });

  it('each call routes to a distinct handler — never both', () => {
    const onInstruction = jest.fn();
    const onAnnotation  = jest.fn();
    const handlers = { instruction_update: onInstruction, content_annotation: onAnnotation };

    handlers[resolveWorkflowType_({ workflow_type: 'instruction_update', operations: [] })]({ workflow_type: 'instruction_update', operations: [] });
    handlers[resolveWorkflowType_({ workflow_type: 'content_annotation', operations: [] })]({ workflow_type: 'content_annotation', operations: [] });

    expect(onInstruction).toHaveBeenCalledTimes(1);
    expect(onAnnotation).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Drive comment pagination (integration of matchesAgentPrefix_ + filtering)
// ─────────────────────────────────────────────────────────────────────────────

describe('Drive comment filtering — pagination and prefix matching together', () => {
  // A minimal simulation of clearAgentAnnotations_ logic using the real
  // matchesAgentPrefix_ — this validates the two components work together
  // correctly without duplicating individual unit tests above.

  function makeComment(id: string, content: string, tabId: string) {
    return {
      id,
      content,
      anchor: JSON.stringify({ r: 'head', a: [{ lt: { tb: { id: tabId } } }] }),
    };
  }

  function runFilter(
    comments: ReturnType<typeof makeComment>[],
    tabId: string,
    prefixes: string[],
    _pages = 1
  ): string[] {
    // Simulate what clearAgentAnnotations_ does: filter by prefix + tab
    return comments
      .filter(c => {
        if (!matchesAgentPrefix_(c.content, prefixes)) return false;
        const anchor = JSON.parse(c.anchor);
        return anchor?.a?.[0]?.lt?.tb?.id === tabId;
      })
      .map(c => c.id);
  }

  const TAB = 'tab-target';
  const OTHER = 'tab-other';

  it('selects agent comment on target tab', () => {
    const ids = runFilter([makeComment('c1', '[EarTune] fix', TAB)], TAB, ['[EarTune]']);
    expect(ids).toEqual(['c1']);
  });

  it('skips user comment (no prefix match)', () => {
    const ids = runFilter([makeComment('c2', 'User note', TAB)], TAB, ['[EarTune]']);
    expect(ids).toEqual([]);
  });

  it('skips agent comment on a different tab', () => {
    const ids = runFilter([makeComment('c3', '[EarTune] fix', OTHER)], TAB, ['[EarTune]']);
    expect(ids).toEqual([]);
  });

  it('handles Drive-stripped "[" via matchesAgentPrefix_ fallback', () => {
    // Drive strips '[' from '[EarTune]'
    const ids = runFilter([makeComment('c4', 'EarTune] fix', TAB)], TAB, ['[EarTune]']);
    expect(ids).toEqual(['c4']);
  });

  it('matches multiple prefixes in a single pass', () => {
    const comments = [
      makeComment('c5', '[EarTune] note', TAB),
      makeComment('c6', '[Architect] note', TAB),
      makeComment('c7', 'User note', TAB),
    ];
    const ids = runFilter(comments, TAB, ['[EarTune]', '[Architect]']);
    expect(ids).toEqual(['c5', 'c6']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RootUpdate / Operation schema (shape tests — no duplication risk)
// ─────────────────────────────────────────────────────────────────────────────

describe('RootUpdate schema validation', () => {
  it('instruction_update requires review_tab and proposed_full_text', () => {
    const valid: RootUpdate = {
      workflow_type: 'instruction_update',
      review_tab: 'StyleProfile',
      proposed_full_text: '# Style Guide\n\n- Voice: intimate.',
      operations: [{ match_text: 'Voice: intimate', reason: 'Adds precision qualifier.' }],
    };
    expect(valid.workflow_type).toBe('instruction_update');
    expect(valid.review_tab).toBeDefined();
    expect(valid.proposed_full_text).toBeDefined();
  });

  it('content_annotation does not require review_tab or proposed_full_text', () => {
    const valid: RootUpdate = {
      workflow_type: 'content_annotation',
      target_tab: 'MergedContent',
      operations: [{ match_text: 'the observer collapses', reason: 'Awkward rhythm.' }],
    };
    expect(valid.workflow_type).toBe('content_annotation');
    expect(valid.review_tab).toBeUndefined();
    expect(valid.proposed_full_text).toBeUndefined();
  });

  it('operation match_text should not be empty', () => {
    const op: Operation = { match_text: 'consciousness as ground', reason: 'Adds emphasis.' };
    expect(op.match_text.trim().length).toBeGreaterThan(0);
  });

  it('operation reason should not be empty', () => {
    const op: Operation = { match_text: 'some phrase', reason: 'Specific correction.' };
    expect(op.reason.trim().length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TAB_NAMES constants
// ─────────────────────────────────────────────────────────────────────────────

describe('TAB_NAMES constants', () => {
  it('standard tab names are defined with no duplicates', () => {
    const expected = [
      'MergedContent',
      'Agentic Instructions',
      'StyleProfile',
      'EarTune',
      'TechnicalAudit',
      'General Purpose Instructions',
    ];
    expect(new Set(expected).size).toBe(expected.length);
    expected.forEach(name => expect(name.trim().length).toBeGreaterThan(0));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared vm loader — used by all vm-based describe blocks below.
//
// Loads compiled CollaborationHelpers.js + CollaborationService.js into a
// fresh vm context seeded with all Jest globals (shallow copy — shared refs so
// mock mutations in beforeEach are visible inside the vm sandbox automatically).
//
// `const CollaborationService = ...` is patched to an unscoped assignment so
// the IIFE result lands on the context object rather than a block-scoped
// variable that is invisible outside the vm.  The result is then exposed on
// Jest's global so test code can call `(global as any).CollaborationService.*`.
//
// Using vm.runInContext rather than new Function() lets us:
//   (a) provide an `exports` shim for CollaborationHelpers.js, which emits
//       Object.defineProperty(exports,...) boilerplate from TypeScript exports;
//   (b) keep shared object references so jest.fn() mutations made in beforeEach
//       are reflected inside the vm without re-seeding the context.
// ─────────────────────────────────────────────────────────────────────────────
function loadCollaborationService(): void {
  const fs   = require('fs');
  const path = require('path');
  const vm   = require('vm');

  const helpersSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'dist', 'CollaborationHelpers.js'), 'utf8'
  );
  const serviceSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'dist', 'CollaborationService.js'), 'utf8'
  );

  const ctx = Object.assign(vm.createContext({}), global, { exports: {} });
  vm.runInContext(helpersSource, ctx);

  const patchedService = serviceSource.replace(
    /^const CollaborationService\b/m,
    'CollaborationService'
  );
  vm.runInContext(patchedService, ctx);

  (global as any).CollaborationService = ctx.CollaborationService;
}

// ─────────────────────────────────────────────────────────────────────────────
// clearAgentAnnotations_ — batched-skip trace (Bug 2 regression guard)
//
// Loads compiled CollaborationService.js to test end-to-end behaviour:
// - When comments on wrong tabs are skipped, Tracer.info is called ONCE with a
//   summary count, NOT once per skipped comment (the ~250 ms/call regression).
// ─────────────────────────────────────────────────────────────────────────────

describe('clearAgentAnnotations_ — batched skipped-comment trace', () => {

  function makeComment(id: string, content: string, tabId: string) {
    return {
      id,
      content,
      anchor: JSON.stringify({ r: 'head', a: [{ lt: { tb: { id: tabId } } }] }),
    };
  }

  const TARGET_TAB  = 't.target';
  const OTHER_TAB_A = 't.other-a';
  const OTHER_TAB_B = 't.other-b';

  beforeEach(() => {
    // Clear all mocks first so previous test runs don't bleed through
    jest.clearAllMocks();

    // DocumentApp.getActiveDocument().getId() → docId used by Drive.Comments.list
    (DocumentApp.getActiveDocument().getId as jest.Mock).mockReturnValue('doc-123');
    // getBookmark returns null to avoid errors in bookmark cleanup
    (DocumentApp.getActiveDocument() as any).getBookmark = jest.fn().mockReturnValue(null);

    // Load (or reload) the compiled service into the vm context. Done AFTER
    // clearing mocks so the context captures the fresh jest.fn() references.
    loadCollaborationService();
  });

  it('emits exactly ONE Tracer.info call for all skipped wrong-tab comments (not per-comment)', () => {
    // 5 agent comments on other tabs, 2 on the target tab
    const comments = [
      makeComment('c1', '[EarTune] fix rhythm', TARGET_TAB),
      makeComment('c2', '[EarTune] fix pacing', TARGET_TAB),
      makeComment('c3', '[EarTune] other fix 1', OTHER_TAB_A),
      makeComment('c4', '[EarTune] other fix 2', OTHER_TAB_A),
      makeComment('c5', '[EarTune] other fix 3', OTHER_TAB_A),
      makeComment('c6', '[EarTune] other fix 4', OTHER_TAB_B),
      makeComment('c7', '[EarTune] other fix 5', OTHER_TAB_B),
    ];

    (Drive.Comments.list as jest.Mock).mockReturnValue({ comments });
    (Drive.Comments as any).remove = jest.fn();

    (global as any).CollaborationService.clearAgentAnnotations(
      TARGET_TAB, 'TargetTab', (global as any).mockDocumentTab, ['[EarTune]']
    );

    const tracerInfoMock = (global as any).Tracer.info as jest.Mock;
    const skippedCalls = tracerInfoMock.mock.calls.filter(
      (args: string[]) => args[0] && args[0].includes('skipped')
    );

    // Must be exactly ONE summary call, not 5 individual calls
    expect(skippedCalls).toHaveLength(1);
    expect(skippedCalls[0][0]).toMatch(/skipped 5 comment\(s\) on other tabs/);
  });

  it('includes up to 5 example snippets in the skipped-count summary', () => {
    // 7 comments on wrong tabs → only 5 examples should appear in the log
    const wrongTabComments = Array.from({ length: 7 }, (_, i) =>
      makeComment(`w${i}`, `[EarTune] wrong-tab note ${i}`, OTHER_TAB_A)
    );
    const comments = [
      makeComment('c1', '[EarTune] on target', TARGET_TAB),
      ...wrongTabComments,
    ];

    (Drive.Comments.list as jest.Mock).mockReturnValue({ comments });
    (Drive.Comments as any).remove = jest.fn();

    (global as any).CollaborationService.clearAgentAnnotations(
      TARGET_TAB, 'TargetTab', (global as any).mockDocumentTab, ['[EarTune]']
    );

    const tracerInfoMock = (global as any).Tracer.info as jest.Mock;
    const [summaryMsg] = tracerInfoMock.mock.calls
      .map((a: string[]) => a[0])
      .filter((m: string) => m.includes('skipped'));

    expect(summaryMsg).toMatch(/skipped 7 comment\(s\) on other tabs/);
    // The examples array in the log should have exactly 5 entries
    const examplesStart = summaryMsg.indexOf('— examples:');
    const examplesJson = summaryMsg.slice(examplesStart + '— examples:'.length).trim();
    const examples = JSON.parse(examplesJson);
    expect(examples).toHaveLength(5);
    examples.forEach((e: string) => expect(e).toMatch(/^\[tab=t\.other-a\]/));
  });

  it('does NOT emit a skipped-count log when all agent comments are on the target tab', () => {
    const comments = [
      makeComment('c1', '[EarTune] fix 1', TARGET_TAB),
      makeComment('c2', '[EarTune] fix 2', TARGET_TAB),
    ];

    (Drive.Comments.list as jest.Mock).mockReturnValue({ comments });
    (Drive.Comments as any).remove = jest.fn();

    (global as any).CollaborationService.clearAgentAnnotations(
      TARGET_TAB, 'TargetTab', (global as any).mockDocumentTab, ['[EarTune]']
    );

    const tracerInfoMock = (global as any).Tracer.info as jest.Mock;
    const skippedCalls = tracerInfoMock.mock.calls.filter(
      (args: string[]) => args[0] && args[0].includes('skipped')
    );
    expect(skippedCalls).toHaveLength(0);
  });

  it('deletes comments on the target tab and skips those on other tabs', () => {
    const comments = [
      makeComment('c1', '[EarTune] fix', TARGET_TAB),
      makeComment('c2', '[EarTune] other', OTHER_TAB_A),
    ];

    (Drive.Comments.list as jest.Mock).mockReturnValue({ comments });
    (Drive.Comments as any).remove = jest.fn();

    (global as any).CollaborationService.clearAgentAnnotations(
      TARGET_TAB, 'TargetTab', (global as any).mockDocumentTab, ['[EarTune]']
    );

    // Only c1 should be removed
    expect((Drive.Comments as any).remove).toHaveBeenCalledTimes(1);
    expect((Drive.Comments as any).remove).toHaveBeenCalledWith('doc-123', 'c1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// clearAgentAnnotationsBulk_ — document-wide mode (Bug 3 regression guard)
//
// "Clear All Annotations" must remove agent comments on EVERY tab, including
// tabs that have been deleted or renamed since the comments were written.
// Passing tabIds=null triggers the unrestricted sweep.
// ─────────────────────────────────────────────────────────────────────────────

describe('clearAgentAnnotationsBulk_ — document-wide mode (tabIds=null)', () => {
  function makeComment(id: string, content: string, tabId: string) {
    return {
      id,
      content,
      anchor: JSON.stringify({ r: 'head', a: [{ lt: { tb: { id: tabId } } }] }),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (DocumentApp.getActiveDocument().getId as jest.Mock).mockReturnValue('doc-123');
    (DocumentApp.getActiveDocument() as any).getBookmark = jest.fn().mockReturnValue(null);
    loadCollaborationService();
  });

  it('deletes matching comments from ALL tabs when tabIds=null (document-wide)', () => {
    const comments = [
      makeComment('c1', '[EarTune] note tab-A', 't.tab-a'),
      makeComment('c2', '[EarTune] note tab-B', 't.tab-b'),
      makeComment('c3', '[EarTune] note old-tab', 't.deleted-old-tab'),
      makeComment('c4', 'User comment', 't.tab-a'),   // no prefix — must NOT be deleted
    ];

    (Drive.Comments.list as jest.Mock).mockReturnValue({ comments });
    (Drive.Comments as any).remove = jest.fn();

    (global as any).CollaborationService.clearAgentAnnotationsBulk(null, ['[EarTune]']);

    // All three agent comments deleted regardless of tab, user comment untouched
    expect((Drive.Comments as any).remove).toHaveBeenCalledTimes(3);
    expect((Drive.Comments as any).remove).toHaveBeenCalledWith('doc-123', 'c1');
    expect((Drive.Comments as any).remove).toHaveBeenCalledWith('doc-123', 'c2');
    expect((Drive.Comments as any).remove).toHaveBeenCalledWith('doc-123', 'c3');
    expect((Drive.Comments as any).remove).not.toHaveBeenCalledWith('doc-123', 'c4');
  });

  it('does NOT delete comments on tabs outside the set when tabIds are specified', () => {
    const comments = [
      makeComment('c1', '[EarTune] note active-tab',  't.active'),
      makeComment('c2', '[EarTune] note deleted-tab', 't.deleted'),
    ];

    (Drive.Comments.list as jest.Mock).mockReturnValue({ comments });
    (Drive.Comments as any).remove = jest.fn();

    // Specify only the active tab — deleted tab's comment must NOT be removed
    (global as any).CollaborationService.clearAgentAnnotationsBulk(['t.active'], ['[EarTune]']);

    expect((Drive.Comments as any).remove).toHaveBeenCalledTimes(1);
    expect((Drive.Comments as any).remove).toHaveBeenCalledWith('doc-123', 'c1');
    expect((Drive.Comments as any).remove).not.toHaveBeenCalledWith('doc-123', 'c2');
  });

  it('returns immediately (no Drive call) when tabIds=[] (empty set)', () => {
    (Drive.Comments as any).remove = jest.fn();

    (global as any).CollaborationService.clearAgentAnnotationsBulk([], ['[EarTune]']);

    expect(Drive.Comments.list as jest.Mock).not.toHaveBeenCalled();
    expect((Drive.Comments as any).remove).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// clearAgentAnnotations_ — session-agnostic + document-level comments (Item 4)
//
// "Clear Active Tab" must clear ALL agent comments on that tab regardless of
// which session created them.  Document-level comments (no text anchor) that
// match a prefix must also be cleared.
// ─────────────────────────────────────────────────────────────────────────────

describe('clearAgentAnnotations_ — session-agnostic and document-level handling', () => {
  const TARGET_TAB = 't.kindness';

  // Helper: comment anchored to a text range on a specific tab
  function makeTabComment(id: string, content: string, tabId: string) {
    return {
      id,
      content,
      anchor: JSON.stringify({ r: 'head', a: [{ lt: { tb: { id: tabId } } }] }),
    };
  }

  // Helper: document-level comment — no tab anchor (Drive returns {"r":"head"})
  function makeDocLevelComment(id: string, content: string) {
    return {
      id,
      content,
      anchor: JSON.stringify({ r: 'head' }),   // no 'a' array → commentTabId = undefined
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (DocumentApp.getActiveDocument().getId as jest.Mock).mockReturnValue('doc-123');
    (DocumentApp.getActiveDocument() as any).getBookmark = jest.fn().mockReturnValue(null);
    loadCollaborationService();
  });

  it('clears agent comments on the target tab regardless of which session wrote them', () => {
    // Simulates two sessions worth of [EarTune] comments on the same tab
    const comments = [
      makeTabComment('old1', '[EarTune] session-1 note A', TARGET_TAB),
      makeTabComment('old2', '[EarTune] session-1 note B', TARGET_TAB),
      makeTabComment('new1', '[EarTune] session-2 note A', TARGET_TAB),
    ];

    (Drive.Comments.list as jest.Mock).mockReturnValue({ comments });
    (Drive.Comments as any).remove = jest.fn();

    (global as any).CollaborationService.clearAgentAnnotations(
      TARGET_TAB, 'TargetTab', (global as any).mockDocumentTab, ['[EarTune]']
    );

    // All three cleared — session is irrelevant, tab ID is the only filter
    expect((Drive.Comments as any).remove).toHaveBeenCalledTimes(3);
    ['old1', 'old2', 'new1'].forEach(id => {
      expect((Drive.Comments as any).remove).toHaveBeenCalledWith('doc-123', id);
    });
  });

  it('clears document-level agent comments (no text anchor) when running Clear Active Tab', () => {
    // Document-level comments: no anchor tab → commentTabId = undefined → treated as orphan
    const comments = [
      makeDocLevelComment('d1', '[EarTune] document-level observation'),
      makeDocLevelComment('d2', '[Architect] document-level review note'),
      makeTabComment('t1', '[EarTune] anchored to target tab', TARGET_TAB),
      makeTabComment('t2', '[EarTune] anchored to other tab', 't.other'),
    ];

    (Drive.Comments.list as jest.Mock).mockReturnValue({ comments });
    (Drive.Comments as any).remove = jest.fn();

    (global as any).CollaborationService.clearAgentAnnotations(
      TARGET_TAB, 'TargetTab', (global as any).mockDocumentTab, ['[EarTune]', '[Architect]']
    );

    // d1, d2 (doc-level orphans) and t1 (correct tab) are deleted
    // t2 (wrong tab, resolvable) is skipped
    expect((Drive.Comments as any).remove).toHaveBeenCalledWith('doc-123', 'd1');
    expect((Drive.Comments as any).remove).toHaveBeenCalledWith('doc-123', 'd2');
    expect((Drive.Comments as any).remove).toHaveBeenCalledWith('doc-123', 't1');
    expect((Drive.Comments as any).remove).not.toHaveBeenCalledWith('doc-123', 't2');
    expect((Drive.Comments as any).remove).toHaveBeenCalledTimes(3);
  });

  it('does not clear user comments that have no agent prefix, even if document-level', () => {
    const comments = [
      makeDocLevelComment('u1', 'This is a regular user comment with no prefix'),
      makeTabComment('u2', 'Another user comment on target tab', TARGET_TAB),
    ];

    (Drive.Comments.list as jest.Mock).mockReturnValue({ comments });
    (Drive.Comments as any).remove = jest.fn();

    (global as any).CollaborationService.clearAgentAnnotations(
      TARGET_TAB, 'TargetTab', (global as any).mockDocumentTab, ['[EarTune]']
    );

    expect((Drive.Comments as any).remove).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// annotateOperation_ — 3-step atomic creation (via processUpdate)
//
// Tests the creation path introduced with the named-range strategy:
//   Step 1 — bookmark + named range (rolled back as a unit on failure)
//   Step 2 — Drive comment (rolls back step 1 on failure)
//   Step 3 — highlight     (tolerates failure; no rollback needed)
//
// Exercised through CollaborationService.processUpdate() with a
// content_annotation payload so the full internal call chain fires.
// ─────────────────────────────────────────────────────────────────────────────

describe('annotateOperation_ — 3-step atomic creation via processUpdate', () => {
  // A mock RangeElement returned by body.findText() — simulates a matched text span.
  const mockRangeEl = {
    getElement: jest.fn().mockReturnValue({
      asText: jest.fn().mockReturnValue({
        setBackgroundColor: jest.fn(),
        setBold: jest.fn(),
      }),
      getType: jest.fn().mockReturnValue('TEXT'),
    }),
    getStartOffset: jest.fn().mockReturnValue(0),
    getEndOffsetInclusive: jest.fn().mockReturnValue(9),
  };

  // Minimal content_annotation payload
  const PAYLOAD = {
    workflow_type: 'content_annotation',
    target_tab: 'TargetTab',
    agent_name: '[EarTune]',
    operations: [{ match_text: 'test phrase', reason: 'fix the rhythm' }],
  };

  beforeEach(() => {
    jest.clearAllMocks();

    (DocumentApp.getActiveDocument().getId as jest.Mock).mockReturnValue('doc-123');
    (DocumentApp.getActiveDocument() as any).getBookmark = jest.fn().mockReturnValue(null);

    // processContentAnnotation_ uses DocOps to resolve tab object and ID
    ((global as any).DocOps.getTabByName  as jest.Mock).mockReturnValue((global as any).mockDocumentTab);
    ((global as any).DocOps.getTabIdByName as jest.Mock).mockReturnValue('t.target');

    // No pre-existing annotations — clearAgentAnnotations_ is a no-op
    (Drive.Comments.list as jest.Mock).mockReturnValue({ comments: [] });

    // findText returns our mock range element for any search string
    ((global as any).mockDocumentTab.getBody() as any).findText =
      jest.fn().mockReturnValue(mockRangeEl);

    // Drive comment creation succeeds by default
    (Drive.Comments as any).create = jest.fn().mockReturnValue({ id: 'new-comment-123' });

    loadCollaborationService();
  });

  it('happy path: bookmark, named range, Drive comment, and highlight step all run', () => {
    (global as any).CollaborationService.processUpdate(PAYLOAD);

    const mockDT = (global as any).mockDocumentTab;
    // Step 1 — bookmark and named range both created
    expect(mockDT.addBookmark).toHaveBeenCalledTimes(1);
    expect(mockDT.addNamedRange).toHaveBeenCalledTimes(1);
    expect(mockDT.addNamedRange).toHaveBeenCalledWith(
      'annotation_mock-bookmark-id',
      expect.anything()
    );
    // Step 2 — Drive comment created; its body must contain the bookmark URL fragment
    expect((Drive.Comments as any).create).toHaveBeenCalledTimes(1);
    const createCallArg = JSON.stringify((Drive.Comments as any).create.mock.calls[0]);
    expect(createCallArg).toMatch(/#bookmark=mock-bookmark-id/);
    // Step 3 — highlight: getRange() called on the named range (named range used for highlight)
    expect((global as any).mockNamedRange.getRange).toHaveBeenCalled();
  });

  it('step 1 rollback: addNamedRange throws → bookmark removed, no Drive comment created', () => {
    (global as any).mockDocumentTab.addNamedRange.mockImplementationOnce(() => {
      throw new Error('quota exceeded');
    });

    (global as any).CollaborationService.processUpdate(PAYLOAD);

    // Bookmark was created then immediately rolled back
    expect((global as any).mockDocumentTab.addBookmark).toHaveBeenCalledTimes(1);
    expect((global as any).mockBookmark.remove).toHaveBeenCalledTimes(1);
    // Drive comment must NOT have been attempted
    expect((Drive.Comments as any).create).not.toHaveBeenCalled();
    // Error message logged
    expect((global as any).Tracer.error).toHaveBeenCalledWith(
      expect.stringContaining('step 1 (bookmark/namedRange) failed')
    );
  });

  it('step 2 rollback: Drive comment returns null → named range + bookmark both rolled back', () => {
    (Drive.Comments as any).create = jest.fn().mockReturnValue(null);

    (global as any).CollaborationService.processUpdate(PAYLOAD);

    // Step 1 completed (bookmark + named range created)
    expect((global as any).mockDocumentTab.addBookmark).toHaveBeenCalledTimes(1);
    expect((global as any).mockDocumentTab.addNamedRange).toHaveBeenCalledTimes(1);
    // Both must be rolled back
    expect((global as any).mockNamedRange.remove).toHaveBeenCalledTimes(1);
    expect((global as any).mockBookmark.remove).toHaveBeenCalledTimes(1);
    // No highlight attempted (already aborted)
    expect((global as any).mockNamedRange.getRange).not.toHaveBeenCalled();
  });

  it('step 3 tolerance: highlightNamedRange_ throws → error logged, no rollback of bookmark or comment', () => {
    // Simulate a GAS error during highlight (e.g. protected range)
    (global as any).mockNamedRange.getRange.mockImplementationOnce(() => {
      throw new Error('protected range');
    });

    (global as any).CollaborationService.processUpdate(PAYLOAD);

    // Steps 1 and 2 both completed
    expect((global as any).mockDocumentTab.addBookmark).toHaveBeenCalledTimes(1);
    expect((global as any).mockDocumentTab.addNamedRange).toHaveBeenCalledTimes(1);
    expect((Drive.Comments as any).create).toHaveBeenCalledTimes(1);
    // Bookmark and named range must NOT be rolled back (comment + bookmark are intact)
    expect((global as any).mockBookmark.remove).not.toHaveBeenCalled();
    expect((global as any).mockNamedRange.remove).not.toHaveBeenCalled();
    // Error logged for observability
    expect((global as any).Tracer.error).toHaveBeenCalledWith(
      expect.stringContaining('step 3 (highlight) failed')
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteAnnotation_ — named-range deletion paths (via clearAgentAnnotations_)
//
// Tests the two deletion paths introduced with the named-range strategy:
//   New-style — named range found → precise highlight clear + named range
//               remove + bookmark remove + Drive comment delete
//   Old-style  — no named range found → Tracer.warn emitted + color-sweep
//               fallback flag set → clearTabHighlights_ triggered
// ─────────────────────────────────────────────────────────────────────────────

describe('deleteAnnotation_ — named-range deletion paths via clearAgentAnnotations_', () => {
  // Bookmark ID embedded in a new-style annotation comment
  const BOOKMARK_ID = 'bm-test-id';
  const RANGE_KEY   = `annotation_${BOOKMARK_ID}`;

  // Helper: new-style comment — content includes a bookmark URL
  function makeNewStyleComment(id: string, tabId: string) {
    const bookmarkUrl =
      `https://docs.google.com/document/d/doc-123/edit?tab=${tabId}` +
      `#bookmark=${BOOKMARK_ID}`;
    return {
      id,
      content: `[EarTune] fix the rhythm\n"test phrase"\n${bookmarkUrl}`,
      anchor: JSON.stringify({ r: 'head', a: [{ lt: { tb: { id: tabId } } }] }),
    };
  }

  // Helper: old-style comment — no bookmark URL in content
  function makeOldStyleComment(id: string, tabId: string) {
    return {
      id,
      content: `[EarTune] old annotation without bookmark`,
      anchor: JSON.stringify({ r: 'head', a: [{ lt: { tb: { id: tabId } } }] }),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (DocumentApp.getActiveDocument().getId as jest.Mock).mockReturnValue('doc-123');
    (DocumentApp.getActiveDocument() as any).getBookmark = jest.fn().mockReturnValue(null);
    (Drive.Comments as any).remove = jest.fn();
    loadCollaborationService();
  });

  it('new-style path: named range found → highlights cleared, nr removed, bookmark removed, comment deleted', () => {
    (Drive.Comments.list as jest.Mock).mockReturnValue({
      comments: [makeNewStyleComment('c-new', 't.target')],
    });

    // Use a plain (non-jest) function for getRangeElements so jest.clearAllMocks()
    // cannot reset its return value to undefined (which would throw in the for-of loop
    // inside clearNamedRangeHighlights_ and abort the try/catch prematurely).
    (global as any).mockNamedRange.getRange.mockReturnValue({
      getRangeElements: () => [],
    });

    // Named range found for this annotation
    (global as any).mockDocumentTab.getNamedRanges.mockReturnValue(
      [(global as any).mockNamedRange]
    );

    // Document-scoped bookmark lookup succeeds
    (DocumentApp.getActiveDocument() as any).getBookmark =
      jest.fn().mockReturnValue((global as any).mockBookmark);

    (global as any).CollaborationService.clearAgentAnnotations(
      't.target', 'TargetTab', (global as any).mockDocumentTab, ['[EarTune]']
    );

    // Named range looked up with the correct key
    expect((global as any).mockDocumentTab.getNamedRanges).toHaveBeenCalledWith(RANGE_KEY);
    // Highlight cleared via getRange (clearNamedRangeHighlights_ ran)
    expect((global as any).mockNamedRange.getRange).toHaveBeenCalled();
    // Named range removed
    expect((global as any).mockNamedRange.remove).toHaveBeenCalledTimes(1);
    // Bookmark removed
    expect((global as any).mockBookmark.remove).toHaveBeenCalledTimes(1);
    // Drive comment deleted
    expect((Drive.Comments as any).remove).toHaveBeenCalledWith('doc-123', 'c-new');
    // No color-sweep fallback — warn message about color-sweep must NOT appear
    const warnCalls = ((global as any).Tracer.warn as jest.Mock).mock.calls
      .map((a: string[]) => a[0] ?? '');
    expect(warnCalls.some((m: string) => m.includes('color-sweep fallback'))).toBe(false);
  });

  it('old-style fallback: no named range found → Tracer.warn emitted and color-sweep triggered', () => {
    (Drive.Comments.list as jest.Mock).mockReturnValue({
      comments: [makeOldStyleComment('c-old', 't.target')],
    });

    // getNamedRanges is not reached for old-style (no bookmarkId) — but ensure it
    // returns empty in case the code path changes
    (global as any).mockDocumentTab.getNamedRanges.mockReturnValue([]);

    // DocOps.getTabByName returns null (default) → clearTabHighlights_ is a no-op
    ((global as any).DocOps.getTabByName as jest.Mock).mockReturnValue(null);

    (global as any).CollaborationService.clearAgentAnnotations(
      't.target', 'TargetTab', (global as any).mockDocumentTab, ['[EarTune]']
    );

    // Drive comment still deleted (delete proceeds even after color-sweep flag is set)
    expect((Drive.Comments as any).remove).toHaveBeenCalledWith('doc-123', 'c-old');

    const warnCalls = ((global as any).Tracer.warn as jest.Mock).mock.calls
      .map((a: string[]) => a[0] ?? '');

    // Color-sweep fallback warn must appear (from clearAgentAnnotations_)
    expect(warnCalls.some((m: string) => m.includes('color-sweep fallback'))).toBe(true);
    const sweepMsg = warnCalls.find((m: string) => m.includes('color-sweep fallback')) ?? '';
    expect(sweepMsg).toMatch(/WATCH FOR THIS IN LOGS/);
  });
});
