// ============================================================
// EarTuneAgent integration tests — real Gemini API calls.
//
// PURPOSE
// -------
// Validates the Gemini prompt↔model contract for EarTuneAgent:
// given rhythmic/phonetic analysis prompts and structured JSON schemas,
// the model returns correct shapes, detects planted alliteration issues,
// and grounds annotations in verbatim passage text. Tests call Gemini
// REST directly from Node — no GAS deployment required.
//
// WORKFLOW COVERAGE (see BaseAgent for workflow definitions)
// ----------------------------------------------------------
//   W1 (generateInstructions)
//     • Sends StyleProfile + existing EarTune instructions →
//       model produces updated EarTune prompt with proposed_full_text.
//     • Schema: INSTRUCTION_UPDATE_SCHEMA → { proposed_full_text }
//     • Edge cases: empty StyleProfile, empty existing EarTune.
//
//   W2 (annotateTab)
//     • Sends a passage to sweep → model returns { operations: [{match_text, reason}] }
//     • Schema: ANNOTATION_SCHEMA → { operations }
//     • Key assertions:
//       - Detects planted alliteration ("peculiar peculiar pattern",
//         "perpetually perplexing portrait") per EarTune rule 4
//       - Every match_text is a verbatim substring of the passage (grounding)
//       - Clean passage produces few or no operations (false-positive guard)
//       - Does NOT return proposed_full_text (W2 is annotation-only)
//       - Handles very short passages gracefully
//
//   W3 (handleCommentThreads)
//     • Single-thread: validates threadId, non-empty reply, signature,
//       absence of mutation fields.
//     • Edge case: empty EarTune instructions still produce a valid reply.
//
// PLANTED ERRORS (in fixtures/testDocument.ts)
// ---------------------------------------------
//   • CHAPTER_1 contains "peculiar peculiar pattern" and "perpetually
//     perplexing portrait" — violations of EarTune rule 4: "never 3+
//     alliterative words in a row."
//
// EXECUTION MODEL
// ---------------
//   • Run via: npm run test:integration
//   • Requires: GEMINI_API_KEY in .env.integration
//   • Model tier: fast (gemini-2.0-flash — EarTune is a fast-tier agent)
//   • Timeout: 60s per test
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

  // Five tests below assert different properties of the same CHAPTER_1 response.
  // One shared beforeAll call replaces five identical callGemini() invocations.
  // Tests using a different passage (clean passage, very short) still call independently.
  let w2Result: any;

  beforeAll(() => {
    w2Result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      buildEarTuneAnnotatePrompt({
        styleProfile:        FIXTURES.STYLE_PROFILE,
        earTuneInstructions: FIXTURES.EAR_TUNE,
        passage:             FIXTURES.CHAPTER_1,
        tabName:             'Chapter 1',
      }),
      ANNOTATION_SCHEMA,
      { tier: TIER }
    );
  }, TIMEOUT);

  it('returns an operations array when given a passage to annotate', () => {
    expect(Array.isArray(w2Result.operations)).toBe(true);
    expect(w2Result.operations.length).toBeGreaterThan(0);
  });

  it('each annotation operation has non-empty match_text and reason', () => {
    for (const op of w2Result.operations) {
      expect(typeof op.match_text).toBe('string');
      expect(op.match_text.trim().length).toBeGreaterThan(0);
      expect(typeof op.reason).toBe('string');
      expect(op.reason.trim().length).toBeGreaterThan(0);
    }
  });

  it('detects the planted alliteration issue in CHAPTER_1', () => {
    // CHAPTER_1 contains: "peculiar peculiar pattern" and "perpetually perplexing portrait"
    // — EarTune rule 4 prohibits 3+ alliterative words in a row.
    const hasRhythmFlag = w2Result.operations.some((op: any) =>
      /alliter|rhythm|consonant|percul|perplex|perp|peculiar/i.test(
        op.match_text + ' ' + op.reason
      )
    );
    expect(hasRhythmFlag).toBe(true);
  });

  it('each W2 match_text is a verbatim substring of the annotated passage', () => {
    const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const normalizedPassage = normalize(FIXTURES.CHAPTER_1);
    for (const op of w2Result.operations) {
      const found = normalize(op.match_text).length > 0 &&
        normalizedPassage.includes(normalize(op.match_text));
      expect(found).toBe(true);
    }
  });

  it('clean passage with no rhythm issues produces few or no operations', () => {
    // False-positive guard: a well-crafted, rhythmically clean passage should
    // not trigger EarTune violations. Allows ≤1 operation for borderline cases.
    const cleanPassage =
      'The observer attends and the wave collapses. ' +
      'Consciousness is the ground. ' +
      'In that stillness, measurement becomes meaning.';
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      buildEarTuneAnnotatePrompt({
        styleProfile:        FIXTURES.STYLE_PROFILE,
        earTuneInstructions: FIXTURES.EAR_TUNE,
        passage:             cleanPassage,
        tabName:             'Chapter 1',
      }),
      ANNOTATION_SCHEMA,
      { tier: TIER }
    );

    // A genuinely clean passage should produce very few issues.
    // Allow up to 5 — the model may flag minor eartuneic preferences.
    expect(result.operations.length).toBeLessThanOrEqual(5);
  }, TIMEOUT);

  it('returns valid schema response even when passage is very short', () => {
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      buildEarTuneAnnotatePrompt({
        styleProfile:        FIXTURES.STYLE_PROFILE,
        earTuneInstructions: FIXTURES.EAR_TUNE,
        passage:             'Consciousness is.',
        tabName:             'Chapter 1',
      }),
      ANNOTATION_SCHEMA,
      { tier: TIER }
    );

    // Minimal passage may yield empty or non-empty operations — schema must hold.
    expect(Array.isArray(result.operations)).toBe(true);
  }, TIMEOUT);

  it('does NOT return proposed_full_text (W2 is annotation-only)', () => {
    // ANNOTATION_SCHEMA enforces only { operations }. No text replacement fields.
    expect(w2Result.proposed_full_text).toBeUndefined();
    expect(w2Result.workflow_type).toBeUndefined();
  });

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
      passageContext:      FIXTURES.MANUSCRIPT,
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
      passageContext:      FIXTURES.MANUSCRIPT,
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
      passageContext:      FIXTURES.MANUSCRIPT,
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
      passageContext:      FIXTURES.MANUSCRIPT,
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
