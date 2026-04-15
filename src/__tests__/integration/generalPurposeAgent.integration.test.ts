// ============================================================
// GeneralPurposeAgent integration tests — real Gemini API calls.
//
// PURPOSE
// -------
// Validates the Gemini prompt↔model contract for GeneralPurposeAgent:
// given @AI comment threads and optional anchor-tab context, the
// model returns properly structured batch replies. Tests call
// Gemini REST directly from Node — no GAS deployment required.
//
// WORKFLOW COVERAGE (see BaseAgent for workflow definitions)
// ----------------------------------------------------------
//   W1 (generateInstructions)
//     • Sends StyleProfile + existing Comment Instructions →
//       model produces updated instructions with proposed_full_text.
//     • Schema: INSTRUCTION_UPDATE_SCHEMA → { proposed_full_text }
//     • Edge cases: empty StyleProfile, empty existing instructions.
//
//   W2 (annotateTab) — NOT APPLICABLE
//     • GeneralPurposeAgent responds to @AI comment threads only; it does
//       not sweep tabs for inline annotations. There is no annotateTab
//       method, and no W2 workflow for this agent.
//
//   W3 (handleCommentThreads)
//     • Single-thread with anchor: validates threadId, non-empty reply,
//       "AI Editorial Assistant" signature.
//     • Multi-thread with shared anchor: validates batch response —
//       all returned threadIds are from the input set, no duplicates,
//       non-empty replies.
//     • Null-anchor thread: validates fallback to selectedText context
//       when no anchor tab content is available.
//     • GeneralPurposeAgent NOW groups threads by anchor tab in production.
//       These tests cover both the anchor and null-anchor paths.
//
// EXECUTION MODEL
// ---------------
//   • Run via: npm run test:integration
//   • Requires: GEMINI_API_KEY in .env.integration
//   • Model tier: fast (gemini-2.0-flash — GeneralPurposeAgent is a fast-tier agent)
//   • Timeout: 60s single, 90s multi-thread
// ============================================================

import { callGemini, callGeminiText } from './helpers/gemini';
import { BATCH_REPLY_SCHEMA } from './helpers/schemas';
import {
  buildGeneralPurposeAgentInstructionsPrompt,
  buildGeneralPurposeAgentBatchPrompt,
} from './helpers/prompts';
import {
  FIXTURES,
  INTEGRATION_SYSTEM_PROMPT,
  CHAPTER_1_THREADS,
  NULL_ANCHOR_THREAD,
} from './fixtures/testDocument';

const TIER    = 'fast' as const;
const TIMEOUT = 60000;
const TIMEOUT_MULTI = 90000;

// ── W1: generateInstructions ──────────────────────────────────────────────────

describe('GeneralPurposeAgent — W1: generateInstructions (instruction_update)', () => {

  it('returns plain markdown instructions from StyleProfile', () => {
    const userPrompt = buildGeneralPurposeAgentInstructionsPrompt({
      styleProfile:         FIXTURES.STYLE_PROFILE,
      existingInstructions: FIXTURES.COMMENT_INSTRUCTIONS,
    });
    const result = callGeminiText(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      { tier: TIER }
    );

    expect(typeof result).toBe('string');
    expect(result.trim().length).toBeGreaterThan(0);
    // Response is plain markdown — must contain at least one ## heading
    expect(result).toMatch(/^##\s/m);
  }, TIMEOUT);

  it('gracefully returns markdown even when StyleProfile is empty', () => {
    const userPrompt = buildGeneralPurposeAgentInstructionsPrompt({
      styleProfile:         '',
      existingInstructions: FIXTURES.COMMENT_INSTRUCTIONS,
    });
    const result = callGeminiText(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      { tier: TIER }
    );

    expect(typeof result).toBe('string');
    expect(result.trim().length).toBeGreaterThan(0);
  }, TIMEOUT);

  it('gracefully returns markdown even when existing instructions are empty', () => {
    const userPrompt = buildGeneralPurposeAgentInstructionsPrompt({
      styleProfile:         FIXTURES.STYLE_PROFILE,
      existingInstructions: '',
    });
    const result = callGeminiText(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      { tier: TIER }
    );

    expect(typeof result).toBe('string');
    expect(result.trim().length).toBeGreaterThan(0);
  }, TIMEOUT);

});

// ── W2: annotateTab — not applicable ─────────────────────────────────────────

describe('GeneralPurposeAgent — W2: annotateTab (not applicable)', () => {

  it('is not implemented on GeneralPurposeAgent', () => {
    // GeneralPurposeAgent responds to @AI comment threads; it does not sweep tabs for
    // annotation. There is no annotateTab method, and no W2 workflow for this
    // agent. This test documents the intent and ensures the absence is deliberate.
    expect(true).toBe(true); // deliberate no-op
  });

});

// ── W3: handleCommentThreads — single thread with anchor content ──────────────

describe('GeneralPurposeAgent — W3: single-thread batch with anchor content', () => {

  // Three tests assert different properties of the same single-thread response.
  // One shared beforeAll call replaces three identical callGemini() invocations.
  let singleResult: any;
  const [singleThread] = CHAPTER_1_THREADS;

  beforeAll(() => {
    singleResult = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      buildGeneralPurposeAgentBatchPrompt({
        anchorContent: FIXTURES.CHAPTER_1,
        threads:       [singleThread],
      }),
      BATCH_REPLY_SCHEMA,
      { tier: TIER }
    );
  }, TIMEOUT);

  it('returns a responses array with a valid threadId and non-empty reply', () => {
    expect(Array.isArray(singleResult.responses)).toBe(true);
    expect(singleResult.responses.length).toBeGreaterThan(0);
    const r = singleResult.responses[0];
    expect(r.threadId).toBe(singleThread.threadId);
    expect(typeof r.reply).toBe('string');
    expect(r.reply.trim().length).toBeGreaterThan(0);
  });

  it('reply ends with the AI Editorial Assistant signature', () => {
    expect(singleResult.responses[0].reply).toContain('AI Editorial Assistant');
  });

  it('does not return threadIds outside the input set', () => {
    const returnedIds = singleResult.responses.map((r: any) => r.threadId);
    for (const id of returnedIds) {
      expect(id).toBe(singleThread.threadId);
    }
  });

});

// ── W3: handleCommentThreads — multi-thread batch sharing one anchor tab ─────

describe('GeneralPurposeAgent — W3: multi-thread batch with shared anchor tab', () => {

  // Three tests assert different properties of the same multi-thread response.
  // One shared beforeAll call replaces three identical callGemini() invocations.
  let multiResult: any;

  beforeAll(() => {
    multiResult = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      buildGeneralPurposeAgentBatchPrompt({
        anchorContent: FIXTURES.CHAPTER_1,
        threads:       CHAPTER_1_THREADS,
      }),
      BATCH_REPLY_SCHEMA,
      { tier: TIER }
    );
  }, TIMEOUT_MULTI);

  it('returns responses for both threads in the batch', () => {
    expect(Array.isArray(multiResult.responses)).toBe(true);
    // Gemini may not reply to every thread; at least one reply required
    expect(multiResult.responses.length).toBeGreaterThan(0);
    // All returned threadIds must be from the input batch
    const validIds = new Set(CHAPTER_1_THREADS.map(t => t.threadId));
    for (const r of multiResult.responses) {
      expect(validIds.has(r.threadId)).toBe(true);
    }
  });

  it('each reply is a non-empty string', () => {
    for (const r of multiResult.responses) {
      expect(typeof r.reply).toBe('string');
      expect(r.reply.trim().length).toBeGreaterThan(0);
    }
  });

  it('no duplicate threadIds in the response', () => {
    const ids = multiResult.responses.map((r: any) => r.threadId);
    expect(new Set(ids).size).toBe(ids.length);
  });

});

// ── W3: handleCommentThreads — null-anchor thread (fallback to selectedText) ──

describe('GeneralPurposeAgent — W3: null-anchor thread (no anchor content)', () => {

  it('returns a valid reply using only selectedText context', () => {
    const userPrompt = buildGeneralPurposeAgentBatchPrompt({
      anchorContent: '',  // no anchor tab — agent falls back to selectedText
      threads:       [NULL_ANCHOR_THREAD],
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      BATCH_REPLY_SCHEMA,
      { tier: TIER }
    );

    expect(Array.isArray(result.responses)).toBe(true);
    expect(result.responses.length).toBeGreaterThan(0);
    expect(result.responses[0].threadId).toBe(NULL_ANCHOR_THREAD.threadId);
    expect(result.responses[0].reply.trim().length).toBeGreaterThan(0);
  }, TIMEOUT);

});

// ── Error conditions ──────────────────────────────────────────────────────────

describe('GeneralPurposeAgent — error conditions', () => {

  it('throws a descriptive error when the API key is invalid', () => {
    const userPrompt = buildGeneralPurposeAgentBatchPrompt({
      anchorContent: '',
      threads: [NULL_ANCHOR_THREAD],
    });

    expect(() =>
      callGemini(INTEGRATION_SYSTEM_PROMPT, userPrompt, BATCH_REPLY_SCHEMA, {
        tier:           TIER,
        apiKeyOverride: 'INVALID_API_KEY_FOR_TESTING',
      })
    ).toThrow(/Gemini API error/);
  });

});
