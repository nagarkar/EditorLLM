import { extractMarkdownFromJsonWrapper, deduplicateTtsOps, stitchingIdsForVoice, recordRequestId } from '../agentHelpers';

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
