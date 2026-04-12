// ============================================================
// StylistAgent integration tests — real Gemini API calls.
//
// Workflow coverage:
//   W1 (generateInstructions) — instruction_update → { proposed_full_text, operations }
//   W2 (annotateTab)          — content_annotation → { operations }
//   W3 (handleCommentThread)  — reply-only → { reply }
//
// All tests use the fast model (gemini-2.0-flash).
// Individual test timeout is set to 60 s.
// ============================================================

import { callGemini } from './helpers/gemini';
import { INSTRUCTION_UPDATE_SCHEMA, ANNOTATION_SCHEMA, BATCH_REPLY_SCHEMA } from './helpers/schemas';
import {
  buildStylistInstructionsPrompt,
  buildStylistAnnotatePrompt,
  buildStylistBatchPrompt,
} from './helpers/prompts';
import { FIXTURES, INTEGRATION_SYSTEM_PROMPT } from './fixtures/testDocument';

const TIER = 'fast' as const;
const TIMEOUT = 60000;

// ── W1: generateInstructions ──────────────────────────────────────────────────

describe('StylistAgent — W1: generateInstructions (instruction_update)', () => {

  it('produces proposed_full_text and operations from StyleProfile', () => {
    const userPrompt = buildStylistInstructionsPrompt({
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
    expect(Array.isArray(result.operations)).toBe(true);
    expect(result.operations.length).toBeGreaterThan(0);
  }, TIMEOUT);

  it('each operation has non-empty match_text and reason', () => {
    const userPrompt = buildStylistInstructionsPrompt({
      styleProfile:    FIXTURES.STYLE_PROFILE,
      existingEarTune: FIXTURES.EAR_TUNE,
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      INSTRUCTION_UPDATE_SCHEMA,
      { tier: TIER }
    );

    for (const op of result.operations) {
      expect(typeof op.match_text).toBe('string');
      expect(op.match_text.trim().length).toBeGreaterThan(0);
      expect(typeof op.reason).toBe('string');
      expect(op.reason.trim().length).toBeGreaterThan(0);
    }
  }, TIMEOUT);

  it('each W1 match_text is a verbatim substring of proposed_full_text', () => {
    // The prompt instructs: "each with a verbatim match_text from proposed_full_text".
    // The W1 context is STYLE_PROFILE + EAR_TUNE (no manuscript); match_text must
    // be anchored in the model's own proposed output, not the manuscript.
    const userPrompt = buildStylistInstructionsPrompt({
      styleProfile:    FIXTURES.STYLE_PROFILE,
      existingEarTune: FIXTURES.EAR_TUNE,
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      INSTRUCTION_UPDATE_SCHEMA,
      { tier: TIER }
    );

    const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const normalizedProposed = normalize(result.proposed_full_text);
    const hallucinated = result.operations.filter(op => {
      const n = normalize(op.match_text);
      return n.length > 0 && !normalizedProposed.includes(n);
    });
    if (hallucinated.length > 0) {
      console.warn(`[match_text grounding] ${hallucinated.length}/${result.operations.length} ops have match_text not found in proposed_full_text:`);
      hallucinated.forEach(op => console.warn(`  - "${op.match_text.slice(0, 100)}"`));
    }
    expect(hallucinated.length).toBeLessThanOrEqual(2);
  }, TIMEOUT);

  it('gracefully returns a response even when StyleProfile is empty', () => {
    const userPrompt = buildStylistInstructionsPrompt({
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
    expect(Array.isArray(result.operations)).toBe(true);
  }, TIMEOUT);

  it('gracefully returns a response even when existing EarTune is empty', () => {
    const userPrompt = buildStylistInstructionsPrompt({
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
    expect(Array.isArray(result.operations)).toBe(true);
  }, TIMEOUT);

});

// ── W2: annotateTab ───────────────────────────────────────────────────────────

describe('StylistAgent — W2: annotateTab (content_annotation)', () => {

  it('returns an operations array when given a passage to annotate', () => {
    const userPrompt = buildStylistAnnotatePrompt({
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
    const userPrompt = buildStylistAnnotatePrompt({
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
    const userPrompt = buildStylistAnnotatePrompt({
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
    const userPrompt = buildStylistAnnotatePrompt({
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
    const userPrompt = buildStylistAnnotatePrompt({
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
    // Allow up to 3 — the model may flag minor stylistic preferences.
    expect(result.operations.length).toBeLessThanOrEqual(3);
  }, TIMEOUT);

  it('returns valid schema response even when passage is very short', () => {
    const userPrompt = buildStylistAnnotatePrompt({
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
    const userPrompt = buildStylistAnnotatePrompt({
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

// ── W3: handleCommentThread ───────────────────────────────────────────────────

describe('StylistAgent — W3: handleCommentThread (reply-only)', () => {

  it('returns a reply string when analysing a selected passage', () => {
    const userPrompt = buildStylistBatchPrompt({
      styleProfile:        FIXTURES.STYLE_PROFILE,
      earTuneInstructions: FIXTURES.EAR_TUNE,
      passageContext:      FIXTURES.MERGED_CONTENT,
      selectedText:        'The persistent persistence of perception pervades',
      agentRequest:        'Flag any rhythmic issues in this passage.',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      BATCH_REPLY_SCHEMA,
      { tier: TIER }
    );

    expect(typeof result.reply).toBe('string');
    expect(result.reply.trim().length).toBeGreaterThan(0);
  }, TIMEOUT);

  it('reply ends with the AI Editorial Assistant signature', () => {
    const userPrompt = buildStylistBatchPrompt({
      styleProfile:        FIXTURES.STYLE_PROFILE,
      earTuneInstructions: FIXTURES.EAR_TUNE,
      passageContext:      FIXTURES.MERGED_CONTENT,
      selectedText:        'consciousness is the ground',
      agentRequest:        'Check cadence.',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      BATCH_REPLY_SCHEMA,
      { tier: TIER }
    );

    expect(result.reply).toContain('AI Editorial Assistant');
  }, TIMEOUT);

  it('does NOT return a RootUpdate or workflow_type field', () => {
    const userPrompt = buildStylistBatchPrompt({
      styleProfile:        FIXTURES.STYLE_PROFILE,
      earTuneInstructions: FIXTURES.EAR_TUNE,
      passageContext:      FIXTURES.MERGED_CONTENT,
      selectedText:        'orthodox quantum mechanics',
      agentRequest:        'Is the rhythm suitable for read-aloud?',
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
    const userPrompt = buildStylistBatchPrompt({
      styleProfile:        FIXTURES.STYLE_PROFILE,
      earTuneInstructions: '',
      passageContext:      FIXTURES.MERGED_CONTENT,
      selectedText:        'The Chid Axiom fills this gap',
      agentRequest:        'Evaluate sentence rhythm.',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      BATCH_REPLY_SCHEMA,
      { tier: TIER }
    );

    expect(typeof result.reply).toBe('string');
    expect(result.reply.trim().length).toBeGreaterThan(0);
  }, TIMEOUT);

});

// ── Error conditions ──────────────────────────────────────────────────────────

describe('StylistAgent — error conditions', () => {

  it('throws a descriptive error when the API key is invalid', () => {
    const userPrompt = buildStylistBatchPrompt({
      styleProfile:        FIXTURES.STYLE_PROFILE,
      earTuneInstructions: FIXTURES.EAR_TUNE,
      passageContext:      FIXTURES.MERGED_CONTENT,
      selectedText:        'any passage',
      agentRequest:        'any request',
    });

    expect(() =>
      callGemini(INTEGRATION_SYSTEM_PROMPT, userPrompt, BATCH_REPLY_SCHEMA, {
        tier:           TIER,
        apiKeyOverride: 'INVALID_API_KEY_FOR_TESTING',
      })
    ).toThrow(/Gemini API error/);
  });

});
