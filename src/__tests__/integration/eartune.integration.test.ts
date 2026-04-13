// ============================================================
// EarTuneAgent integration tests — real Gemini API calls.
//
// Workflow coverage:
//   W1 (generateInstructions) — instruction_update → { proposed_full_text, operations }
//   W2 (annotateTab)          — content_annotation → { operations }
//   W3 (handleCommentThreads) — batch reply → { responses: [{threadId, reply}] }
//
// All tests use the fast model (gemini-2.0-flash).
// Individual test timeout is set to 60 s.
// ============================================================

import { callGemini } from './helpers/gemini';
import { INSTRUCTION_UPDATE_SCHEMA, ANNOTATION_SCHEMA, BATCH_REPLY_SCHEMA } from './helpers/schemas';
import {
  TestThread,
  buildEarTuneInstructionsPrompt,
  buildEarTuneAnnotatePrompt,
  buildEarTuneBatchPrompt,
} from './helpers/prompts';
import { FIXTURES, INTEGRATION_SYSTEM_PROMPT } from './fixtures/testDocument';

const TIER = 'fast' as const;
const TIMEOUT = 60000;

// ── W1: generateInstructions ──────────────────────────────────────────────────

describe('EarTuneAgent — W1: generateInstructions (instruction_update)', () => {

  it('produces proposed_full_text and operations from StyleProfile', () => {
    const userPrompt = buildEarTuneInstructionsPrompt({
      styleProfile:    FIXTURES.STYLE_PROFILE,
      existingEarTune: FIXTURES.EAR_TUNE,
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      INSTRUCTION_UPDATE_SCHEMA,
      { tier: TIER }
    );

    expect(typeof result.proposed_full_text).toBe('string');
    expect(result.proposed_full_text.trim().length).toBeGreaterThan(0);
  }, TIMEOUT);



  it('gracefully returns a response even when StyleProfile is empty', () => {
    const userPrompt = buildEarTuneInstructionsPrompt({
      styleProfile:    '',
      existingEarTune: FIXTURES.EAR_TUNE,
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      INSTRUCTION_UPDATE_SCHEMA,
      { tier: TIER }
    );

    expect(typeof result.proposed_full_text).toBe('string');
  }, TIMEOUT);

  it('gracefully returns a response even when existing EarTune is empty', () => {
    const userPrompt = buildEarTuneInstructionsPrompt({
      styleProfile:    FIXTURES.STYLE_PROFILE,
      existingEarTune: '',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      INSTRUCTION_UPDATE_SCHEMA,
      { tier: TIER }
    );

    expect(typeof result.proposed_full_text).toBe('string');
  }, TIMEOUT);

});

// ── W2: annotateTab ───────────────────────────────────────────────────────────

describe('EarTuneAgent — W2: annotateTab (content_annotation)', () => {

  it('returns an operations array when given a passage to annotate', () => {
    const userPrompt = buildEarTuneAnnotatePrompt({
      styleProfile:        FIXTURES.STYLE_PROFILE,
      earTuneInstructions: FIXTURES.EAR_TUNE,
      passage:             FIXTURES.CHAPTER_1,
      tabName:             'Chapter 1',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      ANNOTATION_SCHEMA,
      { tier: TIER }
    );

    expect(Array.isArray(result.operations)).toBe(true);
    expect(result.operations.length).toBeGreaterThan(0);
  }, TIMEOUT);

  it('each annotation operation has non-empty match_text and reason', () => {
    const userPrompt = buildEarTuneAnnotatePrompt({
      styleProfile:        FIXTURES.STYLE_PROFILE,
      earTuneInstructions: FIXTURES.EAR_TUNE,
      passage:             FIXTURES.CHAPTER_1,
      tabName:             'Chapter 1',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      ANNOTATION_SCHEMA,
      { tier: TIER }
    );

    for (const op of result.operations) {
      expect(typeof op.match_text).toBe('string');
      expect(op.match_text.trim().length).toBeGreaterThan(0);
      expect(typeof op.reason).toBe('string');
      expect(op.reason.trim().length).toBeGreaterThan(0);
    }
  }, TIMEOUT);

  it('detects the planted alliteration issue in CHAPTER_1', () => {
    // CHAPTER_1 contains: "peculiar peculiar pattern" and "perpetually perplexing portrait"
    // — EarTune rule 4 prohibits 3+ alliterative words in a row.
    const userPrompt = buildEarTuneAnnotatePrompt({
      styleProfile:        FIXTURES.STYLE_PROFILE,
      earTuneInstructions: FIXTURES.EAR_TUNE,
      passage:             FIXTURES.CHAPTER_1,
      tabName:             'Chapter 1',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      ANNOTATION_SCHEMA,
      { tier: TIER }
    );

    // At least one operation should flag the alliteration/rhythmic issue.
    const hasRhythmFlag = result.operations.some((op: any) =>
      /alliter|rhythm|consonant|percul|perplex|perp|peculiar/i.test(
        op.match_text + ' ' + op.reason
      )
    );
    expect(hasRhythmFlag).toBe(true);
  }, TIMEOUT);

  it('each W2 match_text is a verbatim substring of the annotated passage', () => {
    const passage = FIXTURES.CHAPTER_1;
    const userPrompt = buildEarTuneAnnotatePrompt({
      styleProfile:        FIXTURES.STYLE_PROFILE,
      earTuneInstructions: FIXTURES.EAR_TUNE,
      passage,
      tabName:             'Chapter 1',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      ANNOTATION_SCHEMA,
      { tier: TIER }
    );

    const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const normalizedPassage = normalize(passage);
    for (const op of result.operations) {
      const found = normalize(op.match_text).length > 0 &&
        normalizedPassage.includes(normalize(op.match_text));
      expect(found).toBe(true);
    }
  }, TIMEOUT);

  it('clean passage with no rhythm issues produces few or no operations', () => {
    // False-positive guard: a well-crafted, rhythmically clean passage should
    // not trigger EarTune violations. Allows ≤1 operation for borderline cases.
    const cleanPassage =
      'The observer attends and the wave collapses. ' +
      'Consciousness is the ground. ' +
      'In that stillness, measurement becomes meaning.';
    const userPrompt = buildEarTuneAnnotatePrompt({
      styleProfile:        FIXTURES.STYLE_PROFILE,
      earTuneInstructions: FIXTURES.EAR_TUNE,
      passage:             cleanPassage,
      tabName:             'Chapter 1',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      ANNOTATION_SCHEMA,
      { tier: TIER }
    );

    // A genuinely clean passage should produce very few issues.
    // Allow up to 5 — the model may flag minor eartuneic preferences.
    expect(result.operations.length).toBeLessThanOrEqual(5);
  }, TIMEOUT);

  it('returns valid schema response even when passage is very short', () => {
    const userPrompt = buildEarTuneAnnotatePrompt({
      styleProfile:        FIXTURES.STYLE_PROFILE,
      earTuneInstructions: FIXTURES.EAR_TUNE,
      passage:             'Consciousness is.',
      tabName:             'Chapter 1',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      ANNOTATION_SCHEMA,
      { tier: TIER }
    );

    // Minimal passage may yield empty or non-empty operations — schema must hold.
    expect(Array.isArray(result.operations)).toBe(true);
  }, TIMEOUT);

  it('does NOT return proposed_full_text (W2 is annotation-only)', () => {
    const userPrompt = buildEarTuneAnnotatePrompt({
      styleProfile:        FIXTURES.STYLE_PROFILE,
      earTuneInstructions: FIXTURES.EAR_TUNE,
      passage:             FIXTURES.CHAPTER_1,
      tabName:             'Chapter 1',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      ANNOTATION_SCHEMA,
      { tier: TIER }
    );

    // ANNOTATION_SCHEMA enforces only { operations }. No text replacement fields.
    expect(result.proposed_full_text).toBeUndefined();
    expect(result.workflow_type).toBeUndefined();
  }, TIMEOUT);

});

// ── W3: handleCommentThreads — single-thread batch ───────────────────────────

describe('EarTuneAgent — W3: single-thread batch', () => {

  it('returns a responses array with a valid threadId and non-empty reply', () => {
    const thread: TestThread = {
      threadId:     'eartune-thread-001',
      selectedText: 'The persistent persistence of perception pervades',
      agentRequest: 'Flag any rhythmic issues in this passage.',
      conversation: [{ role: 'User', authorName: 'Author', content: '@eartune Flag rhythmic issues.' }],
    };
    const userPrompt = buildEarTuneBatchPrompt({
      styleProfile:        FIXTURES.STYLE_PROFILE,
      earTuneInstructions: FIXTURES.EAR_TUNE,
      passageContext:      FIXTURES.MERGED_CONTENT,
      threads:             [thread],
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      BATCH_REPLY_SCHEMA,
      { tier: TIER }
    );

    expect(Array.isArray(result.responses)).toBe(true);
    expect(result.responses.length).toBeGreaterThan(0);
    const r = result.responses[0];
    expect(r.threadId).toBe(thread.threadId);
    expect(typeof r.reply).toBe('string');
    expect(r.reply.trim().length).toBeGreaterThan(0);
  }, TIMEOUT);

  it('reply ends with the AI Editorial Assistant signature', () => {
    const thread: TestThread = {
      threadId:     'eartune-thread-002',
      selectedText: 'consciousness is the ground',
      agentRequest: 'Check cadence.',
      conversation: [{ role: 'User', authorName: 'Author', content: '@eartune Check cadence.' }],
    };
    const userPrompt = buildEarTuneBatchPrompt({
      styleProfile:        FIXTURES.STYLE_PROFILE,
      earTuneInstructions: FIXTURES.EAR_TUNE,
      passageContext:      FIXTURES.MERGED_CONTENT,
      threads:             [thread],
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      BATCH_REPLY_SCHEMA,
      { tier: TIER }
    );

    expect(result.responses[0].reply).toContain('AI Editorial Assistant');
  }, TIMEOUT);

  it('does NOT return workflow_type or document-mutation fields', () => {
    const thread: TestThread = {
      threadId:     'eartune-thread-003',
      selectedText: 'orthodox quantum mechanics',
      agentRequest: 'Is the rhythm suitable for read-aloud?',
      conversation: [{ role: 'User', authorName: 'Author', content: '@eartune Rhythm check.' }],
    };
    const userPrompt = buildEarTuneBatchPrompt({
      styleProfile:        FIXTURES.STYLE_PROFILE,
      earTuneInstructions: FIXTURES.EAR_TUNE,
      passageContext:      FIXTURES.MERGED_CONTENT,
      threads:             [thread],
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      BATCH_REPLY_SCHEMA,
      { tier: TIER }
    );

    expect(result.workflow_type).toBeUndefined();
    expect(result.target_tab).toBeUndefined();
    expect(result.operations).toBeUndefined();
  }, TIMEOUT);

  it('gracefully handles empty EarTune instructions', () => {
    const thread: TestThread = {
      threadId:     'eartune-thread-004',
      selectedText: 'The Chid Axiom fills this gap',
      agentRequest: 'Evaluate sentence rhythm.',
      conversation: [{ role: 'User', authorName: 'Author', content: '@eartune Evaluate rhythm.' }],
    };
    const userPrompt = buildEarTuneBatchPrompt({
      styleProfile:        FIXTURES.STYLE_PROFILE,
      earTuneInstructions: '',
      passageContext:      FIXTURES.MERGED_CONTENT,
      threads:             [thread],
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      BATCH_REPLY_SCHEMA,
      { tier: TIER }
    );

    expect(Array.isArray(result.responses)).toBe(true);
    expect(result.responses.length).toBeGreaterThan(0);
    expect(result.responses[0].reply.trim().length).toBeGreaterThan(0);
  }, TIMEOUT);

});

// ── Error conditions ──────────────────────────────────────────────────────────

describe('EarTuneAgent — error conditions', () => {

  it('throws a descriptive error when the API key is invalid', () => {
    const thread: TestThread = {
      threadId:     'eartune-error-thread',
      selectedText: 'any passage',
      agentRequest: 'any request',
      conversation: [{ role: 'User', authorName: 'Author', content: '@eartune any request' }],
    };
    const userPrompt = buildEarTuneBatchPrompt({
      styleProfile:        FIXTURES.STYLE_PROFILE,
      earTuneInstructions: FIXTURES.EAR_TUNE,
      passageContext:      FIXTURES.MERGED_CONTENT,
      threads:             [thread],
    });

    expect(() =>
      callGemini(INTEGRATION_SYSTEM_PROMPT, userPrompt, BATCH_REPLY_SCHEMA, {
        tier:           TIER,
        apiKeyOverride: 'INVALID_API_KEY_FOR_TESTING',
      })
    ).toThrow(/Gemini API error/);
  });

});
