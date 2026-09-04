import {
  extractMarkdownFromJsonWrapper,
  deduplicateTtsOps,
  buildEllipsisBreakDirectives,
  firstLineForMatchText,
  applyTtsOperationDefaults,
  TTS_DEFAULT_STABILITY,
  TTS_DEFAULT_SIMILARITY_BOOST,
  H1_BREAK_MS,
  H2_BREAK_MS,
  H3_PLUS_BREAK_MS,
  getHeadingDurationMsForLevel,
  computeHeadingBreakBoundaries,
  stitchingIdsForVoice,
  recordRequestId,
  validateEarTuneOps,
} from '../agentHelpers';

// ── Helpers ──────────────────────────────────────────────────────────────────

function op(
  match_text: string,
  tts_model = 'model_a',
  voice_id  = 'voice_x',
  stability = 0.5,
  similarity_boost = 0.75
) {
  return { match_text, tts_model, voice_id, stability, similarity_boost };
}

// ── deduplicateTtsOps ────────────────────────────────────────────────────────

describe('deduplicateTtsOps', () => {

  it('returns empty array when given no ops', () => {
    expect(deduplicateTtsOps('Some passage text.', [])).toEqual([]);
  });

  it('keeps a single op unchanged', () => {
    const passage = 'Hello world.';
    const result  = deduplicateTtsOps(passage, [op('Hello')]);
    expect(result).toHaveLength(1);
    expect(result[0].match_text).toBe('Hello');
  });

  it('preserves ops with different TTS params (no dedup)', () => {
    const passage = 'First sentence. Second sentence. Third sentence.';
    const ops = [
      op('First sentence',  'model_a', 'voice_x'),
      op('Second sentence', 'model_a', 'voice_y'), // different voice
      op('Third sentence',  'model_b', 'voice_x'), // different model
    ];
    expect(deduplicateTtsOps(passage, ops)).toHaveLength(3);
  });

  it('removes a consecutive duplicate (identical TTS params)', () => {
    const passage = 'Alpha text. Beta text. Gamma text.';
    const ops = [
      op('Alpha text', 'model_a', 'voice_x', 0.5, 0.75),
      op('Beta text',  'model_a', 'voice_x', 0.5, 0.75), // same as above — should be removed
      op('Gamma text', 'model_a', 'voice_y', 0.5, 0.75), // different voice — kept
    ];
    const result = deduplicateTtsOps(passage, ops);
    expect(result).toHaveLength(2);
    expect(result[0].match_text).toBe('Alpha text');
    expect(result[1].match_text).toBe('Gamma text');
  });

  it('only removes *consecutive* duplicates — non-consecutive duplicates are kept', () => {
    // voice_x → voice_y → voice_x: the second voice_x is NOT consecutive with the
    // first, so it must be kept (it marks a real return to the original voice).
    const passage = 'Part one. Part two. Part three.';
    const ops = [
      op('Part one',   'model_a', 'voice_x'),
      op('Part two',   'model_a', 'voice_y'), // different — kept
      op('Part three', 'model_a', 'voice_x'), // same as first but not consecutive — kept
    ];
    expect(deduplicateTtsOps(passage, ops)).toHaveLength(3);
  });

  it('sorts ops into document order before deduplicating', () => {
    // Gemini returns ops in reverse document order.  Without sorting first,
    // dedup would compare passage-3 with passage-2, missing the real duplicate.
    const passage = 'Passage one. Passage two. Passage three.';
    // passage-1 and passage-3 have identical params; passage-2 differs.
    // In Gemini output order: [3, 1, 2].  After sort: [1, 2, 3].
    // Correct dedup: keep 1 (first), keep 2 (different voice), keep 3 (different from 2).
    const ops = [
      op('Passage three', 'model_a', 'voice_x'), // pos 2 in document
      op('Passage one',   'model_a', 'voice_x'), // pos 0 in document
      op('Passage two',   'model_a', 'voice_y'), // pos 1 in document
    ];
    const result = deduplicateTtsOps(passage, ops);
    expect(result).toHaveLength(3);
    expect(result[0].match_text).toBe('Passage one');
    expect(result[1].match_text).toBe('Passage two');
    expect(result[2].match_text).toBe('Passage three');
  });

  it('deduplicates correctly when sort changes the duplicate relationship', () => {
    // In Gemini output: [B, A, C] where A and B have the same params.
    // Without sort, B would be kept (first) and A removed.
    // After sorting by doc position [A, B, C], A is kept and B is the duplicate.
    // The net effect is the same length (1 removed), but the *retained* op must
    // be A (document-first), not B.
    const passage = 'Sentence A is first. Sentence B is second. Sentence C is last.';
    const ops = [
      op('Sentence B is second', 'model_a', 'voice_x'), // doc pos 1
      op('Sentence A is first',  'model_a', 'voice_x'), // doc pos 0 — should survive dedup
      op('Sentence C is last',   'model_a', 'voice_y'), // doc pos 2 — different
    ];
    const result = deduplicateTtsOps(passage, ops);
    expect(result).toHaveLength(2);
    expect(result[0].match_text).toBe('Sentence A is first');
    expect(result[1].match_text).toBe('Sentence C is last');
  });

  it('keeps only the first op when all share identical TTS params', () => {
    const passage = 'Line one. Line two. Line three. Line four.';
    const ops = [
      op('Line one',   'model_a', 'voice_x'),
      op('Line two',   'model_a', 'voice_x'),
      op('Line three', 'model_a', 'voice_x'),
      op('Line four',  'model_a', 'voice_x'),
    ];
    const result = deduplicateTtsOps(passage, ops);
    expect(result).toHaveLength(1);
    expect(result[0].match_text).toBe('Line one');
  });

  it('treats stability as a distinguishing field', () => {
    const passage = 'First part. Second part.';
    const ops = [
      op('First part',  'model_a', 'voice_x', 0.5,  0.75),
      op('Second part', 'model_a', 'voice_x', 0.9,  0.75), // stability differs — kept
    ];
    expect(deduplicateTtsOps(passage, ops)).toHaveLength(2);
  });

  it('treats similarity_boost as a distinguishing field', () => {
    const passage = 'First part. Second part.';
    const ops = [
      op('First part',  'model_a', 'voice_x', 0.5, 0.75),
      op('Second part', 'model_a', 'voice_x', 0.5, 0.9), // similarity_boost differs — kept
    ];
    expect(deduplicateTtsOps(passage, ops)).toHaveLength(2);
  });

  it('handles whitespace normalisation when finding positions', () => {
    // The passage has extra spaces; the op match_text has single spaces.
    const passage = 'First   part of text.  Second   part of text.';
    const ops = [
      op('First part of text',  'model_a', 'voice_x'),
      op('Second part of text', 'model_a', 'voice_y'),
    ];
    const result = deduplicateTtsOps(passage, ops);
    expect(result).toHaveLength(2);
    expect(result[0].match_text).toBe('First part of text');
    expect(result[1].match_text).toBe('Second part of text');
  });

  it('does not mutate the input array', () => {
    const passage = 'Alpha. Beta. Gamma.';
    const original = [
      op('Gamma', 'model_a', 'voice_x'),
      op('Alpha', 'model_a', 'voice_x'),
      op('Beta',  'model_a', 'voice_y'),
    ];
    const inputCopy = original.map(o => ({ ...o }));
    deduplicateTtsOps(passage, original);
    expect(original).toEqual(inputCopy);
  });

});

// ── buildEllipsisBreakDirectives ─────────────────────────────────────────────

describe('buildEllipsisBreakDirectives', () => {

  it('always returns both ASCII "..." and Unicode "…" break directives unconditionally', () => {
    const result = buildEllipsisBreakDirectives();
    expect(result).toHaveLength(2);
    expect(result.map(d => d.match_text).sort()).toEqual(['...', '…']);
    for (const d of result) {
      expect(d.type).toBe('break');
      expect(d.payload).toEqual({ timeMs: 1000 });
      expect(d.apply_to).toBe('every_occurrence');
    }
  });

  it('does not depend on any passage input — passage scanning is delegated to CollaborationService', () => {
    // Calling with no argument is valid; the function takes no parameters.
    expect(buildEllipsisBreakDirectives()).toEqual(buildEllipsisBreakDirectives());
  });

});

// ── firstLineForMatchText ────────────────────────────────────────────────────

describe('firstLineForMatchText', () => {

  it('returns single-line input unchanged', () => {
    expect(firstLineForMatchText('Hello world')).toBe('Hello world');
  });

  it('returns the first non-empty line of multi-line input, trimmed', () => {
    const input = 'Seven More Sermons To The Dead\n…\nEpilogue\n…';
    expect(firstLineForMatchText(input)).toBe('Seven More Sermons To The Dead');
  });

  it('skips leading empty lines', () => {
    expect(firstLineForMatchText('\n\n   \nFirst real line\nsecond')).toBe('First real line');
  });

  it('handles \\r\\n line endings', () => {
    expect(firstLineForMatchText('Line one\r\nLine two')).toBe('Line one');
  });

  it('handles bare \\r line endings', () => {
    expect(firstLineForMatchText('Line one\rLine two')).toBe('Line one');
  });

  it('returns empty string for empty input', () => {
    expect(firstLineForMatchText('')).toBe('');
  });

  it('returns trimmed input when only whitespace and no line breaks', () => {
    expect(firstLineForMatchText('   trimmed   ')).toBe('trimmed');
  });

  it('preserves internal whitespace within the line (findText regex tolerates spaces)', () => {
    expect(firstLineForMatchText('Hello   double   spaces')).toBe('Hello   double   spaces');
  });

});

// ── applyTtsOperationDefaults ────────────────────────────────────────────────

describe('applyTtsOperationDefaults', () => {

  function ttsOp(overrides: Partial<{ stability: number; similarity_boost: number }> = {}) {
    return {
      match_text: 'Hello',
      tts_model: 'eleven_multilingual_v2',
      voice_id: 'voice_x',
      stability: 0.6,
      similarity_boost: 0.75,
      ...overrides,
    };
  }

  it('passes through ops with valid non-zero values unchanged (returns same reference)', () => {
    const op = ttsOp();
    const result = applyTtsOperationDefaults(op);
    expect(result.op).toBe(op);
    expect(result.appliedStability).toBe(false);
    expect(result.appliedSimilarityBoost).toBe(false);
  });

  it('replaces stability=0 with the project default', () => {
    const result = applyTtsOperationDefaults(ttsOp({ stability: 0 }));
    expect(result.op.stability).toBe(TTS_DEFAULT_STABILITY);
    expect(result.appliedStability).toBe(true);
    expect(result.appliedSimilarityBoost).toBe(false);
  });

  it('replaces similarity_boost=0 with the project default', () => {
    const result = applyTtsOperationDefaults(ttsOp({ similarity_boost: 0 }));
    expect(result.op.similarity_boost).toBe(TTS_DEFAULT_SIMILARITY_BOOST);
    expect(result.appliedSimilarityBoost).toBe(true);
    expect(result.appliedStability).toBe(false);
  });

  it('replaces both when both are 0', () => {
    const result = applyTtsOperationDefaults(ttsOp({ stability: 0, similarity_boost: 0 }));
    expect(result.op.stability).toBe(TTS_DEFAULT_STABILITY);
    expect(result.op.similarity_boost).toBe(TTS_DEFAULT_SIMILARITY_BOOST);
    expect(result.appliedStability).toBe(true);
    expect(result.appliedSimilarityBoost).toBe(true);
  });

  it('replaces undefined / null / NaN values with defaults', () => {
    const r1 = applyTtsOperationDefaults(ttsOp({ stability: undefined as any, similarity_boost: null as any }));
    expect(r1.op.stability).toBe(TTS_DEFAULT_STABILITY);
    expect(r1.op.similarity_boost).toBe(TTS_DEFAULT_SIMILARITY_BOOST);

    const r2 = applyTtsOperationDefaults(ttsOp({ stability: NaN }));
    expect(r2.op.stability).toBe(TTS_DEFAULT_STABILITY);
  });

  it('preserves small but non-zero positive values (does not treat them as "gave up")', () => {
    const result = applyTtsOperationDefaults(ttsOp({ stability: 0.05, similarity_boost: 0.001 }));
    expect(result.op.stability).toBe(0.05);
    expect(result.op.similarity_boost).toBe(0.001);
    expect(result.appliedStability).toBe(false);
    expect(result.appliedSimilarityBoost).toBe(false);
  });

  it('does not mutate the input op when applying defaults', () => {
    const op = ttsOp({ stability: 0, similarity_boost: 0 });
    const snapshot = { ...op };
    applyTtsOperationDefaults(op);
    expect(op).toEqual(snapshot);
  });

});

// ── getHeadingDurationMsForLevel ─────────────────────────────────────────────

describe('getHeadingDurationMsForLevel', () => {

  it('maps H1 to 3250ms', () => {
    expect(getHeadingDurationMsForLevel(1)).toBe(3250);
    expect(H1_BREAK_MS).toBe(3250);
  });

  it('maps H2 to 2250ms', () => {
    expect(getHeadingDurationMsForLevel(2)).toBe(2250);
    expect(H2_BREAK_MS).toBe(2250);
  });

  it('maps H3 through H6 to 1250ms', () => {
    expect(getHeadingDurationMsForLevel(3)).toBe(1250);
    expect(getHeadingDurationMsForLevel(4)).toBe(1250);
    expect(getHeadingDurationMsForLevel(5)).toBe(1250);
    expect(getHeadingDurationMsForLevel(6)).toBe(1250);
    expect(H3_PLUS_BREAK_MS).toBe(1250);
  });

  it('returns 0 for invalid levels (0, negative, >6)', () => {
    expect(getHeadingDurationMsForLevel(0)).toBe(0);
    expect(getHeadingDurationMsForLevel(-1)).toBe(0);
    expect(getHeadingDurationMsForLevel(7)).toBe(0);
    expect(getHeadingDurationMsForLevel(99)).toBe(0);
  });

});

// ── computeHeadingBreakBoundaries ────────────────────────────────────────────

describe('computeHeadingBreakBoundaries', () => {

  it('returns no boundaries when there are no headings', () => {
    expect(computeHeadingBreakBoundaries([null, null, null])).toEqual([]);
  });

  it('returns no boundaries for an empty paragraph list', () => {
    expect(computeHeadingBreakBoundaries([])).toEqual([]);
  });

  it('emits a single before-break for an H1 at the start of the tab', () => {
    // [H1, body] — boundary 0 (before H1) and boundary 1 (after H1, before body)
    expect(computeHeadingBreakBoundaries([1, null])).toEqual([
      { atParagraphIndex: 0, durationMs: 3250 },
      { atParagraphIndex: 1, durationMs: 3250 },
    ]);
  });

  it('emits before+after breaks for an H2 surrounded by body paragraphs', () => {
    // [body, H2, body]
    expect(computeHeadingBreakBoundaries([null, 2, null])).toEqual([
      { atParagraphIndex: 1, durationMs: 2250 }, // before H2
      { atParagraphIndex: 2, durationMs: 2250 }, // after H2
    ]);
  });

  it('emits ONE break between two adjacent headings using the SMALLER duration', () => {
    // [H1, H2, body] — boundary between H1 and H2 takes min(3250, 2250) = 2250
    expect(computeHeadingBreakBoundaries([1, 2, null])).toEqual([
      { atParagraphIndex: 0, durationMs: 3250 }, // before H1
      { atParagraphIndex: 1, durationMs: 2250 }, // between H1 and H2 (min)
      { atParagraphIndex: 2, durationMs: 2250 }, // after H2 → body
    ]);
  });

  it('cascades the min-duration rule across three adjacent headings', () => {
    // [H1, H2, H3, body]
    expect(computeHeadingBreakBoundaries([1, 2, 3, null])).toEqual([
      { atParagraphIndex: 0, durationMs: 3250 }, // before H1
      { atParagraphIndex: 1, durationMs: 2250 }, // between H1, H2 → min(3250, 2250)
      { atParagraphIndex: 2, durationMs: 1250 }, // between H2, H3 → min(2250, 1250)
      { atParagraphIndex: 3, durationMs: 1250 }, // after H3 → body
    ]);
  });

  it('does not emit a boundary after the last paragraph (would be a trailing break)', () => {
    // [body, body, H1] — H1 is the final paragraph; no after-break.
    expect(computeHeadingBreakBoundaries([null, null, 1])).toEqual([
      { atParagraphIndex: 2, durationMs: 3250 }, // before H1
    ]);
  });

  it('handles non-adjacent headings independently', () => {
    // [H1, body, body, H2, body]
    expect(computeHeadingBreakBoundaries([1, null, null, 2, null])).toEqual([
      { atParagraphIndex: 0, durationMs: 3250 }, // before H1
      { atParagraphIndex: 1, durationMs: 3250 }, // after H1 → body
      { atParagraphIndex: 3, durationMs: 2250 }, // before H2
      { atParagraphIndex: 4, durationMs: 2250 }, // after H2 → body
    ]);
  });

  it('uses each heading\'s own duration when adjacent same-level (min of equals)', () => {
    // [H1, H1] — second H1 at end (no after-break)
    expect(computeHeadingBreakBoundaries([1, 1])).toEqual([
      { atParagraphIndex: 0, durationMs: 3250 },
      { atParagraphIndex: 1, durationMs: 3250 },
    ]);
  });

});

describe('validateEarTuneOps', () => {

  const passage =
    'No virtue bindeth him forever, nor doth any moral rule constrain him unto eternity-neither for love of heaven, nor for fear of hell.';

  it('keeps an op with a distinct Suggested rewrite', () => {
    const ops = [{
      match_text: 'moral rule constrain',
      reason: 'Cadence is overburdened at the turn. Suggested rewrite: "nor doth any moral law constrain him for eternity, neither for love of heaven nor fear of hell."',
    }];

    expect(validateEarTuneOps(ops, passage)).toEqual(ops);
  });

  it('drops an op when Suggested rewrite is missing', () => {
    const ops = [{
      match_text: 'moral rule constrain',
      reason: 'Cadence is overburdened at the turn.',
    }];

    expect(validateEarTuneOps(ops, passage)).toEqual([]);
  });

  it('drops an op when Suggested rewrite repeats passage text verbatim', () => {
    const ops = [{
      match_text: 'moral rule constrain',
      reason: 'Cadence improvement. Suggested rewrite: "nor doth any moral rule constrain him unto eternity-neither for love of heaven, nor for fear of hell."',
    }];

    expect(validateEarTuneOps(ops, passage)).toEqual([]);
  });

  it('ignores phonetic lexicon appendix when extracting Suggested rewrite', () => {
    const ops = [{
      match_text: 'moral rule constrain',
      reason:
        'Cadence is dense. Suggested rewrite: "nor doth any moral law constrain him for eternity."\\n' +
        '## Phonetic Lexicon Suggestions\\n' +
        '- Word: Chid\\n' +
        '- Phonetic: CHID\\n' +
        '- Context: Chid Axiom',
    }];

    expect(validateEarTuneOps(ops, passage)).toEqual(ops);
  });
});

// ── stitchingIdsForVoice + recordRequestId ───────────────────────────────────

describe('stitchingIdsForVoice', () => {

  it('returns [] when stitching is disabled regardless of history', () => {
    const history = { voice_a: ['req1', 'req2'] };
    expect(stitchingIdsForVoice('voice_a', history, false)).toEqual([]);
  });

  it('returns [] for a voice with no history yet', () => {
    expect(stitchingIdsForVoice('voice_new', {}, true)).toEqual([]);
  });

  it('returns the accumulated IDs for the requested voice', () => {
    const history = { voice_a: ['req1', 'req2'], voice_b: ['req3'] };
    expect(stitchingIdsForVoice('voice_a', history, true)).toEqual(['req1', 'req2']);
  });

  it('does NOT return IDs from a different voice', () => {
    const history = { voice_b: ['req3', 'req4'] };
    expect(stitchingIdsForVoice('voice_a', history, true)).toEqual([]);
  });

  it('returns a copy — mutating the result does not affect the history map', () => {
    const history = { voice_a: ['req1'] };
    const ids = stitchingIdsForVoice('voice_a', history, true);
    ids.push('injected');
    expect(history['voice_a']).toEqual(['req1']);
  });

});

describe('recordRequestId', () => {

  it('adds the first ID for a new voice', () => {
    const history: Record<string, string[]> = {};
    recordRequestId('voice_a', 'req1', history);
    expect(history['voice_a']).toEqual(['req1']);
  });

  it('appends to an existing list for the same voice', () => {
    const history = { voice_a: ['req1'] };
    recordRequestId('voice_a', 'req2', history);
    expect(history['voice_a']).toEqual(['req1', 'req2']);
  });

  it('keeps separate lists for different voices', () => {
    const history: Record<string, string[]> = {};
    recordRequestId('voice_a', 'req1', history);
    recordRequestId('voice_b', 'req2', history);
    recordRequestId('voice_a', 'req3', history);
    expect(history['voice_a']).toEqual(['req1', 'req3']);
    expect(history['voice_b']).toEqual(['req2']);
  });

  it('ignores empty request IDs', () => {
    const history: Record<string, string[]> = {};
    recordRequestId('voice_a', '', history);
    expect(history['voice_a']).toBeUndefined();
  });

});

describe('stitchingIdsForVoice + recordRequestId integration', () => {

  it('simulates a two-voice alternating sequence with correct per-voice continuity', () => {
    // Segments in document order: A1(va), B1(vb), A2(va), B2(vb), A3(va)
    // After each call we record the returned request ID.
    // The stitching IDs for each call must only include IDs from the same voice.
    const history: Record<string, string[]> = {};

    // Segment 1 — voice_a, first call: no prior IDs
    expect(stitchingIdsForVoice('voice_a', history, true)).toEqual([]);
    recordRequestId('voice_a', 'ra1', history);

    // Segment 2 — voice_b, first call: no prior IDs for voice_b
    expect(stitchingIdsForVoice('voice_b', history, true)).toEqual([]);
    recordRequestId('voice_b', 'rb1', history);

    // Segment 3 — voice_a again: only ra1 (not rb1)
    expect(stitchingIdsForVoice('voice_a', history, true)).toEqual(['ra1']);
    recordRequestId('voice_a', 'ra2', history);

    // Segment 4 — voice_b again: only rb1 (not ra1/ra2)
    expect(stitchingIdsForVoice('voice_b', history, true)).toEqual(['rb1']);
    recordRequestId('voice_b', 'rb2', history);

    // Segment 5 — voice_a again: ra1 and ra2 (not rb*)
    expect(stitchingIdsForVoice('voice_a', history, true)).toEqual(['ra1', 'ra2']);
  });

});

describe('extractMarkdownFromJsonWrapper', () => {
  it('returns plain string if no fence is present', () => {
    expect(extractMarkdownFromJsonWrapper('Plain text')).toBe('Plain text');
  });

  it('removes ```json fence and parses JSON if valid', () => {
    const validJson = '```json\n{"data": "Hello World"}\n```';
    expect(extractMarkdownFromJsonWrapper(validJson)).toBe('Hello World');
  });

  it('removes generic ``` fence and returns text if not JSON', () => {
    const genericFence = '```\n# Header\n- Item 1\n```';
    expect(extractMarkdownFromJsonWrapper(genericFence)).toBe('# Header\n- Item 1');
  });

  it('removes language-specific fence like ```markdown if not JSON', () => {
    const markdownFence = '```markdown\n## Title\nSome content\n```';
    expect(extractMarkdownFromJsonWrapper(markdownFence)).toBe('## Title\nSome content');
  });

  it('ignores starting with # since it is likely already markdown', () => {
    const alreadyMd = '### Title\n```\nCode\n```';
    expect(extractMarkdownFromJsonWrapper(alreadyMd)).toBe(alreadyMd);
  });
});
