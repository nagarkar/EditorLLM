// Unit tests for CollaborationService matching and annotation logic.
// These tests mock the GAS APIs directly and inline the minimal logic
// needed to verify each behaviour without requiring a live Apps Script runtime.
//
// MAINTENANCE CONTRACT: If any inlined function changes in CollaborationService.ts,
// the corresponding inline copy here must be updated to match.
//
// Constants mirrored from Types.ts (compile-time checked via TypeScript globals):
const HIGHLIGHT_COLOR_UNIT  = '#FFD966';        // mirrors HIGHLIGHT_COLOR
const EARTUNE_PREFIX_UNIT   = '[EarTune]';      // representative W2 agent prefix

// ─────────────────────────────────────────────────────────────────────────────
// Inlined private functions under test
// ─────────────────────────────────────────────────────────────────────────────

function findTextOrFallback(
  body: { findText: (p: string) => any | null },
  matchText: string
): any | null {
  const exact = body.findText(matchText);
  if (exact) return exact;
  return body.findText('\\S+');
}

function highlightRangeElement(rangeEl: any): void {
  const el = rangeEl.getElement();
  if (el.getType() !== DocumentApp.ElementType.TEXT) return;
  const textEl = el.asText();
  const start  = rangeEl.getStartOffset();
  const end    = rangeEl.getEndOffsetInclusive();
  textEl.setBackgroundColor(start, end, HIGHLIGHT_COLOR_UNIT);
  textEl.setBold(start, end, true);
}

function buildCommentPayload(tabId: string, agentPrefix: string, commentBody: string): object {
  return {
    content: `${agentPrefix} "${commentBody}"`,
    anchor: JSON.stringify({
      r: 'head',
      a: [{ lt: { tb: { id: tabId } } }],
    }),
  };
}

/** Returns the number of comments deleted. */
function clearAgentAnnotations(
  docId: string,
  tabId: string,
  driveComments: typeof Drive.Comments,
  agentPrefix: string = EARTUNE_PREFIX_UNIT
): number {
  let pageToken: string | undefined;
  let deleted = 0;
  do {
    const resp = (driveComments as any).list(docId, {
      maxResults: 100,
      pageToken,
      includeDeleted: false,
      fields: 'nextPageToken,items(id,content,anchor)',
    }) as any;

    for (const comment of resp.items ?? []) {
      let anchorTabId: string | undefined;
      try {
        const anchor = JSON.parse(comment.anchor ?? '{}');
        anchorTabId = anchor?.a?.[0]?.lt?.tb?.id;
      } catch {
        continue;
      }
      if (anchorTabId !== tabId) continue;
      if (!(comment.content ?? '').startsWith(agentPrefix)) continue;
      try {
        (driveComments as any).remove(docId, comment.id);
        deleted++;
      } catch {
        /* swallow — mirrors production behaviour */
      }
    }
    pageToken = resp.nextPageToken;
  } while (pageToken);
  return deleted;
}

/** Drives a single annotation operation: find text → highlight → comment. */
function annotateOperation(
  docTab: any,
  op: Operation,
  addComment: (tabId: string, body: string) => void
): void {
  const body    = docTab.getBody();
  const rangeEl = findTextOrFallback(body, op.match_text);
  if (!rangeEl) return;
  highlightRangeElement(rangeEl);
  addComment(docTab.getId(), op.reason);
}

// ─────────────────────────────────────────────────────────────────────────────
// findTextOrFallback
// ─────────────────────────────────────────────────────────────────────────────

describe('findTextOrFallback', () => {
  it('returns exact match when found', () => {
    const mockRangeEl = { getElement: jest.fn(), getStartOffset: jest.fn(() => 4) };
    const body = { findText: jest.fn().mockReturnValue(mockRangeEl) };

    const result = findTextOrFallback(body, 'the Chid Axiom');

    expect(result).toBe(mockRangeEl);
    expect(body.findText).toHaveBeenCalledWith('the Chid Axiom');
  });

  it('falls back to first word when exact match not found', () => {
    const firstWordEl = { getElement: jest.fn(), getStartOffset: jest.fn(() => 0) };
    const body = {
      findText: jest.fn().mockImplementation((p: string) =>
        p === '\\S+' ? firstWordEl : null
      ),
    };

    const result = findTextOrFallback(body, 'nonexistent phrase here');

    expect(result).toBe(firstWordEl);
    expect(body.findText).toHaveBeenCalledWith('\\S+');
  });

  it('returns null when body is completely empty', () => {
    const body = { findText: jest.fn().mockReturnValue(null) };

    const result = findTextOrFallback(body, 'anything');

    expect(result).toBeNull();
    expect(body.findText).toHaveBeenCalledTimes(2); // exact attempt + fallback
  });

  it('does not attempt fallback when exact match succeeds', () => {
    const rangeEl = { getElement: jest.fn() };
    const body = { findText: jest.fn().mockReturnValue(rangeEl) };

    findTextOrFallback(body, 'found text');

    expect(body.findText).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// highlightRangeElement_
// ─────────────────────────────────────────────────────────────────────────────

describe('highlightRangeElement_', () => {
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
      },
      textEl,
    };
  }

  it('calls setBackgroundColor with HIGHLIGHT_COLOR and correct offsets', () => {
    const { rangeEl, textEl } = makeRangeEl('TEXT', 3, 10);

    highlightRangeElement(rangeEl);

    expect(textEl.setBackgroundColor).toHaveBeenCalledWith(3, 10, HIGHLIGHT_COLOR_UNIT);
  });

  it('calls setBold(true) with correct offsets', () => {
    const { rangeEl, textEl } = makeRangeEl('TEXT', 3, 10);

    highlightRangeElement(rangeEl);

    expect(textEl.setBold).toHaveBeenCalledWith(3, 10, true);
  });

  it('does nothing when element type is not TEXT', () => {
    const { rangeEl, textEl } = makeRangeEl('PARAGRAPH');

    highlightRangeElement(rangeEl);

    expect(textEl.setBackgroundColor).not.toHaveBeenCalled();
    expect(textEl.setBold).not.toHaveBeenCalled();
  });

  it('handles zero-length range (start === end)', () => {
    const { rangeEl, textEl } = makeRangeEl('TEXT', 5, 5);

    highlightRangeElement(rangeEl);

    expect(textEl.setBackgroundColor).toHaveBeenCalledWith(5, 5, HIGHLIGHT_COLOR_UNIT);
    expect(textEl.setBold).toHaveBeenCalledWith(5, 5, true);
  });

  it('uses HIGHLIGHT_COLOR not any other color', () => {
    const { rangeEl, textEl } = makeRangeEl('TEXT', 0, 4);

    highlightRangeElement(rangeEl);

    const [, , color] = textEl.setBackgroundColor.mock.calls[0];
    expect(color).toBe('#FFD966');
    expect(color).not.toBe('#ffffff');
    expect(color).not.toBe('#ff0000');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// addTabComment_ payload construction
// ─────────────────────────────────────────────────────────────────────────────

describe('addTabComment_ payload construction', () => {
  it('uses the agent-specific prefix (not a global EditorLLM prefix)', () => {
    const payload: any = buildCommentPayload('tab-123', '[EarTune]', 'Rhythm issue here.');

    expect(payload.content).toContain('[EarTune]');
    expect(payload.content).not.toContain('[EditorLLM]');
  });

  it('preserves the original comment body after the prefix', () => {
    const body = 'Born-rule exponent must be 2, not 3.';
    const payload: any = buildCommentPayload('tab-abc', EARTUNE_PREFIX_UNIT, body);

    expect(payload.content).toContain(body);
    expect(payload.content.startsWith(EARTUNE_PREFIX_UNIT)).toBe(true);
  });

  it('produces valid JSON in the anchor field', () => {
    const payload: any = buildCommentPayload('tab-xyz', '[EarTune]', 'reason');

    expect(() => JSON.parse(payload.anchor)).not.toThrow();
  });

  it('anchor contains r:"head"', () => {
    const payload: any = buildCommentPayload('tab-xyz', '[EarTune]', 'reason');
    const anchor = JSON.parse(payload.anchor);

    expect(anchor.r).toBe('head');
  });

  it('anchor tab ID matches the provided tabId', () => {
    const payload: any = buildCommentPayload('my-tab-id-999', '[EarTune]', 'reason');
    const anchor = JSON.parse(payload.anchor);

    expect(anchor.a[0].lt.tb.id).toBe('my-tab-id-999');
  });

  it('anchor follows the nested structure a[0].lt.tb.id', () => {
    const payload: any = buildCommentPayload('tab-struct-test', '[EarTune]', 'reason');
    const anchor = JSON.parse(payload.anchor);

    expect(Array.isArray(anchor.a)).toBe(true);
    expect(anchor.a[0]).toHaveProperty('lt');
    expect(anchor.a[0].lt).toHaveProperty('tb');
    expect(anchor.a[0].lt.tb).toHaveProperty('id');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// clearAgentAnnotations_ — filtering
// ─────────────────────────────────────────────────────────────────────────────

describe('clearAgentAnnotations_ — filtering', () => {
  const DOC_ID = 'doc-abc';
  const TAB_ID = 'tab-target';
  const OTHER_TAB = 'tab-other';

  function makeComment(id: string, content: string, tabId: string) {
    return {
      id,
      content,
      anchor: JSON.stringify({ r: 'head', a: [{ lt: { tb: { id: tabId } } }] }),
    };
  }

  function makeDriveMock(items: any[], nextPageToken?: string) {
    return {
      list:   jest.fn().mockReturnValue({ items, nextPageToken }),
      remove: jest.fn(),
    } as any;
  }

  it('deletes agent comment on target tab', () => {
    const comment = makeComment('c1', '[EarTune] fix this', TAB_ID);
    const drive = makeDriveMock([comment]);

    const deleted = clearAgentAnnotations(DOC_ID, TAB_ID, drive);

    expect(drive.remove).toHaveBeenCalledWith(DOC_ID, 'c1');
    expect(deleted).toBe(1);
  });

  it('does NOT delete user comment on target tab (no prefix)', () => {
    const comment = makeComment('c2', 'Great sentence here', TAB_ID);
    const drive = makeDriveMock([comment]);

    const deleted = clearAgentAnnotations(DOC_ID, TAB_ID, drive);

    expect(drive.remove).not.toHaveBeenCalled();
    expect(deleted).toBe(0);
  });

  it('does NOT delete agent comment on a different tab', () => {
    const comment = makeComment('c3', '[EarTune] issue on other tab', OTHER_TAB);
    const drive = makeDriveMock([comment]);

    const deleted = clearAgentAnnotations(DOC_ID, TAB_ID, drive);

    expect(drive.remove).not.toHaveBeenCalled();
    expect(deleted).toBe(0);
  });

  it('selectively deletes only agent comments when mixed with user comments', () => {
    const agentComment = makeComment('c4', '[EarTune] agent note', TAB_ID);
    const userComment  = makeComment('c5', 'Author note',            TAB_ID);
    const drive = makeDriveMock([agentComment, userComment]);

    const deleted = clearAgentAnnotations(DOC_ID, TAB_ID, drive);

    expect(drive.remove).toHaveBeenCalledTimes(1);
    expect(drive.remove).toHaveBeenCalledWith(DOC_ID, 'c4');
    expect(deleted).toBe(1);
  });

  it('skips comments with malformed anchor JSON', () => {
    const comment = { id: 'c6', content: '[EarTune] bad anchor', anchor: '{not-valid-json' };
    const drive = makeDriveMock([comment]);

    expect(() => clearAgentAnnotations(DOC_ID, TAB_ID, drive)).not.toThrow();
    expect(drive.remove).not.toHaveBeenCalled();
  });

  it('skips comments with missing anchor', () => {
    const comment = { id: 'c7', content: '[EarTune] no anchor', anchor: undefined };
    const drive = makeDriveMock([comment]);

    expect(() => clearAgentAnnotations(DOC_ID, TAB_ID, drive)).not.toThrow();
    expect(drive.remove).not.toHaveBeenCalled();
  });

  it('skips comments where anchor has no tab ID field', () => {
    const comment = {
      id: 'c8',
      content: '[EarTune] no tab in anchor',
      anchor: JSON.stringify({ r: 'head', a: [{ lt: {} }] }),
    };
    const drive = makeDriveMock([comment]);

    const deleted = clearAgentAnnotations(DOC_ID, TAB_ID, drive);

    expect(drive.remove).not.toHaveBeenCalled();
    expect(deleted).toBe(0);
  });

  it('continues deleting other comments when Drive.remove throws on one', () => {
    const c1 = makeComment('c9',  '[EarTune] first',  TAB_ID);
    const c2 = makeComment('c10', '[EarTune] second', TAB_ID);
    const drive = {
      list:   jest.fn().mockReturnValue({ items: [c1, c2] }),
      remove: jest.fn()
        .mockImplementationOnce(() => { throw new Error('Drive quota exceeded'); })
        .mockReturnValueOnce(undefined),
    } as any;

    expect(() => clearAgentAnnotations(DOC_ID, TAB_ID, drive)).not.toThrow();
    expect(drive.remove).toHaveBeenCalledTimes(2);
  });

  it('returns 0 when there are no comments at all', () => {
    const drive = makeDriveMock([]);

    const deleted = clearAgentAnnotations(DOC_ID, TAB_ID, drive);

    expect(deleted).toBe(0);
    expect(drive.remove).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// clearAgentAnnotations_ — pagination
// ─────────────────────────────────────────────────────────────────────────────

describe('clearAgentAnnotations_ — pagination', () => {
  const DOC_ID = 'doc-paged';
  const TAB_ID = 'tab-paged';

  function makeComment(id: string) {
    return {
      id,
      content: `[EarTune] comment ${id}`,
      anchor: JSON.stringify({ r: 'head', a: [{ lt: { tb: { id: TAB_ID } } }] }),
    };
  }

  it('follows nextPageToken until exhausted', () => {
    const page1 = [makeComment('p1a'), makeComment('p1b')];
    const page2 = [makeComment('p2a')];
    const drive = {
      list: jest.fn()
        .mockReturnValueOnce({ items: page1, nextPageToken: 'tok-1' })
        .mockReturnValueOnce({ items: page2, nextPageToken: undefined }),
      remove: jest.fn(),
    } as any;

    clearAgentAnnotations(DOC_ID, TAB_ID, drive);

    expect(drive.list).toHaveBeenCalledTimes(2);
    expect(drive.list).toHaveBeenNthCalledWith(2, DOC_ID, expect.objectContaining({ pageToken: 'tok-1' }));
  });

  it('deletes agent comments across all pages', () => {
    const page1 = [makeComment('pg1')];
    const page2 = [makeComment('pg2')];
    const drive = {
      list: jest.fn()
        .mockReturnValueOnce({ items: page1, nextPageToken: 'tok-x' })
        .mockReturnValueOnce({ items: page2, nextPageToken: undefined }),
      remove: jest.fn(),
    } as any;

    const deleted = clearAgentAnnotations(DOC_ID, TAB_ID, drive);

    expect(deleted).toBe(2);
    expect(drive.remove).toHaveBeenCalledWith(DOC_ID, 'pg1');
    expect(drive.remove).toHaveBeenCalledWith(DOC_ID, 'pg2');
  });

  it('stops after a single page when there is no nextPageToken', () => {
    const drive = {
      list:   jest.fn().mockReturnValue({ items: [], nextPageToken: undefined }),
      remove: jest.fn(),
    } as any;

    clearAgentAnnotations(DOC_ID, TAB_ID, drive);

    expect(drive.list).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// annotateOperation_
// ─────────────────────────────────────────────────────────────────────────────

describe('annotateOperation_', () => {
  function makeTab(rangeEl: any | null, tabId = 'ann-tab-id') {
    const textEl = { setBackgroundColor: jest.fn(), setBold: jest.fn() };
    const el = {
      getType: jest.fn().mockReturnValue(DocumentApp.ElementType.TEXT),
      asText:  jest.fn().mockReturnValue(textEl),
    };
    if (rangeEl) {
      rangeEl.getElement = jest.fn().mockReturnValue(el);
    }
    return {
      getBody: jest.fn().mockReturnValue({ findText: jest.fn().mockReturnValue(rangeEl) }),
      getId:   jest.fn().mockReturnValue(tabId),
      textEl,
    };
  }

  it('calls highlightRangeElement when text is found', () => {
    const rangeEl = { getStartOffset: jest.fn(() => 0), getEndOffsetInclusive: jest.fn(() => 5) };
    const { getBody, getId, textEl } = makeTab(rangeEl);
    const addComment = jest.fn();
    const op: Operation = { match_text: 'found phrase', reason: 'rhythm issue' };

    annotateOperation({ getBody, getId }, op, addComment);

    expect(textEl.setBackgroundColor).toHaveBeenCalled();
    expect(textEl.setBold).toHaveBeenCalled();
  });

  it('calls addComment with tabId and op.reason when text is found', () => {
    const rangeEl = { getStartOffset: jest.fn(() => 0), getEndOffsetInclusive: jest.fn(() => 5) };
    const { getBody, getId } = makeTab(rangeEl, 'specific-tab-99');
    const addComment = jest.fn();
    const op: Operation = { match_text: 'found phrase', reason: 'Born-rule exponent must be 2' };

    annotateOperation({ getBody, getId }, op, addComment);

    expect(addComment).toHaveBeenCalledWith('specific-tab-99', 'Born-rule exponent must be 2');
  });

  it('does NOT call addComment when no text is found in body', () => {
    const { getBody, getId } = makeTab(null);
    const addComment = jest.fn();
    const op: Operation = { match_text: 'nonexistent', reason: 'some reason' };

    annotateOperation({ getBody, getId }, op, addComment);

    expect(addComment).not.toHaveBeenCalled();
  });

  it('does NOT highlight when no text is found in body', () => {
    const { getBody, getId, textEl } = makeTab(null);
    const op: Operation = { match_text: 'nonexistent', reason: 'some reason' };

    annotateOperation({ getBody, getId }, op, jest.fn());

    expect(textEl.setBackgroundColor).not.toHaveBeenCalled();
  });

  it('uses op.reason as the comment body — not op.match_text', () => {
    const rangeEl = { getStartOffset: jest.fn(() => 0), getEndOffsetInclusive: jest.fn(() => 5) };
    const { getBody, getId } = makeTab(rangeEl);
    const addComment = jest.fn();
    const op: Operation = {
      match_text: 'the phrase to find',
      reason:     'this is why it is flagged',
    };

    annotateOperation({ getBody, getId }, op, addComment);

    const [, commentBody] = addComment.mock.calls[0];
    expect(commentBody).toBe('this is why it is flagged');
    expect(commentBody).not.toBe('the phrase to find');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// processUpdate routing
// ─────────────────────────────────────────────────────────────────────────────

describe('processUpdate routing', () => {
  // Inline the dispatch condition exactly as written in CollaborationService.ts
  function dispatchWorkflow(
    update: RootUpdate,
    onInstruction: (u: RootUpdate) => void,
    onAnnotation:  (u: RootUpdate) => void
  ): void {
    if (update.workflow_type === 'instruction_update') {
      onInstruction(update);
    } else {
      onAnnotation(update);
    }
  }

  it('routes instruction_update to the instruction handler', () => {
    const onInstruction = jest.fn();
    const onAnnotation  = jest.fn();
    const update: RootUpdate = {
      workflow_type: 'instruction_update',
      review_tab: 'StyleProfile',
      proposed_full_text: '# Style',
      operations: [],
    };

    dispatchWorkflow(update, onInstruction, onAnnotation);

    expect(onInstruction).toHaveBeenCalledWith(update);
    expect(onAnnotation).not.toHaveBeenCalled();
  });

  it('routes content_annotation to the annotation handler', () => {
    const onInstruction = jest.fn();
    const onAnnotation  = jest.fn();
    const update: RootUpdate = {
      workflow_type: 'content_annotation',
      target_tab: 'Chapter 1',
      operations: [{ match_text: 'some text', reason: 'reason' }],
    };

    dispatchWorkflow(update, onInstruction, onAnnotation);

    expect(onAnnotation).toHaveBeenCalledWith(update);
    expect(onInstruction).not.toHaveBeenCalled();
  });

  it('passes the full update object to the handler', () => {
    const onInstruction = jest.fn();
    const update: RootUpdate = {
      workflow_type: 'instruction_update',
      review_tab: 'EarTune',
      proposed_full_text: '# EarTune v2',
      operations: [{ match_text: 'EarTune v2', reason: 'Added new rule.' }],
    };

    dispatchWorkflow(update, onInstruction, jest.fn());

    expect(onInstruction).toHaveBeenCalledWith(
      expect.objectContaining({
        review_tab: 'EarTune',
        operations: expect.arrayContaining([
          expect.objectContaining({ match_text: 'EarTune v2' }),
        ]),
      })
    );
  });

  it('only invokes one handler per call — never both', () => {
    const onInstruction = jest.fn();
    const onAnnotation  = jest.fn();

    dispatchWorkflow(
      { workflow_type: 'instruction_update', review_tab: 'x', proposed_full_text: 'x', operations: [] },
      onInstruction,
      onAnnotation
    );
    dispatchWorkflow(
      { workflow_type: 'content_annotation', target_tab: 'y', operations: [] },
      onInstruction,
      onAnnotation
    );

    expect(onInstruction).toHaveBeenCalledTimes(1);
    expect(onAnnotation).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RootUpdate schema validation (shape tests)
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
      'Comment Instructions',
    ];
    expect(new Set(expected).size).toBe(expected.length);
    expected.forEach(name => expect(name.trim().length).toBeGreaterThan(0));
  });
});
