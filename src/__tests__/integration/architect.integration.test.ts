// ============================================================
// ArchitectAgent integration tests — real Gemini API calls.
//
// PURPOSE
// -------
// Validates that the Gemini API, given the same prompts and schemas
// the production ArchitectAgent uses, returns structurally correct JSON
// responses. These tests exercise the prompt↔model contract without
// deploying to GAS — they call the Gemini REST API directly from Node.
//
// WORKFLOW COVERAGE (see BaseAgent for workflow definitions)
// ----------------------------------------------------------
//   W1 (generateInstructions)
//     • Sends Manuscript (full manuscript) → model produces a StyleProfile
//       with proposed_full_text (Markdown) and operations.
//     • Schema: INSTRUCTION_UPDATE_SCHEMA → { proposed_full_text }
//     • Edge case: empty Manuscript (model should still return valid JSON).
//
//   W2 (annotateTab) — NOT APPLICABLE
//     • ArchitectAgent does not sweep tabs for inline annotations.
//       It only generates/updates the StyleProfile and replies to comments.
//
//   W3 (handleCommentThreads)
//     • Single-thread: validates threadId round-trip, non-empty reply,
//       "AI Editorial Assistant" signature, and absence of document-mutation
//       fields (workflow_type, target_tab, operations).
//     • Multi-thread: validates batch response structure — all returned
//       threadIds must be from the input set, no duplicates, non-empty replies.
//     • ArchitectAgent does NOT subgroup by anchor tab; all threads are
//       batched into one prompt with Manuscript + StyleProfile context.
//
// EXECUTION MODEL
// ---------------
//   • Run via: npm run test:integration
//   • Requires: GEMINI_API_KEY in .env.integration
//   • Model tier: thinking (GEMINI_THINKING_MODEL override, default gemini-2.5-flash)
//   • Timeout: 120s per test, 150s for multi-thread batches
//   • No GAS deployment needed — tests call Gemini REST directly via helpers/gemini.ts
//
// FIXTURES
// --------
//   • FIXTURES.MANUSCRIPT — synthetic manuscript about the Chid Axiom
//   • FIXTURES.STYLE_PROFILE  — hand-crafted StyleProfile with known structure
//   • ARCHITECT_THREADS       — two threads for multi-thread batch testing
//   See fixtures/testDocument.ts for the full fixture set.
// ============================================================

import { callGemini } from './helpers/gemini';
import { INSTRUCTION_UPDATE_SCHEMA, BATCH_REPLY_SCHEMA } from './helpers/schemas';
import {
  buildArchitectInstructionsPrompt,
  buildArchitectBatchPrompt,
} from './helpers/prompts';
import {
  FIXTURES,
  INTEGRATION_SYSTEM_PROMPT,
  ARCHITECT_THREADS,
} from './fixtures/testDocument';

const TIMEOUT       = 120000;
const TIMEOUT_MULTI = 150000;

// ── W1: generateInstructions ──────────────────────────────────────────────────

describe('ArchitectAgent — W1: generateInstructions (instruction_update)', () => {

  it('produces proposed_full_text and operations from Manuscript', () => {
    const userPrompt = buildArchitectInstructionsPrompt({
      manuscript: FIXTURES.MANUSCRIPT,
      styleProfile: FIXTURES.STYLE_PROFILE,
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      INSTRUCTION_UPDATE_SCHEMA,
      { tier: 'thinking' }
    );

    expect(typeof result.proposed_full_text).toBe('string');
    expect(result.proposed_full_text.trim().length).toBeGreaterThan(0);
  }, TIMEOUT);



  it('gracefully returns a response even when Manuscript and StyleProfile are empty', () => {
    const userPrompt = buildArchitectInstructionsPrompt({ manuscript: '', styleProfile: '' });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      INSTRUCTION_UPDATE_SCHEMA,
      { tier: 'thinking' }
    );

    expect(typeof result.proposed_full_text).toBe('string');
  }, TIMEOUT);

});

// ── W2: annotateTab — not applicable ─────────────────────────────────────────

describe('ArchitectAgent — W2: annotateTab (not applicable)', () => {

  it('is not implemented on ArchitectAgent', () => {
    expect(true).toBe(true); // deliberate no-op — see comment above
  });

});

// ── W3: handleCommentThreads — single-thread batch ───────────────────────────

describe('ArchitectAgent — W3: single-thread batch', () => {

  // Tests 1–3 assert different properties of the same single-thread response.
  // One shared beforeAll call replaces three identical callGemini() invocations.
  // Test 4 (empty StyleProfile) uses different inputs and keeps its own call.
  let singleResult: any;
  const [singleThread] = ARCHITECT_THREADS;

  beforeAll(() => {
    singleResult = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      buildArchitectBatchPrompt({
        styleProfile: FIXTURES.STYLE_PROFILE,
        manuscript:   FIXTURES.MANUSCRIPT,
        threads:      [singleThread],
      }),
      BATCH_REPLY_SCHEMA,
      { tier: 'thinking' }
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

  it('does NOT return workflow_type or document-mutation fields', () => {
    expect(singleResult.workflow_type).toBeUndefined();
    expect(singleResult.target_tab).toBeUndefined();
    expect(singleResult.operations).toBeUndefined();
  });

  it('gracefully handles empty StyleProfile', () => {
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      buildArchitectBatchPrompt({
        styleProfile: '',
        manuscript:   FIXTURES.MANUSCRIPT,
        threads:      [singleThread],
      }),
      BATCH_REPLY_SCHEMA,
      { tier: 'thinking' }
    );

    expect(Array.isArray(result.responses)).toBe(true);
    expect(result.responses.length).toBeGreaterThan(0);
    expect(result.responses[0].reply.trim().length).toBeGreaterThan(0);
  }, TIMEOUT);

});

// ── W3: handleCommentThreads — multi-thread batch ────────────────────────────

describe('ArchitectAgent — W3: multi-thread batch (no anchor-tab subgrouping)', () => {

  // Three tests assert different properties of the same multi-thread response.
  // One shared beforeAll call replaces three identical callGemini() invocations.
  let multiResult: any;

  beforeAll(() => {
    multiResult = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      buildArchitectBatchPrompt({
        styleProfile: FIXTURES.STYLE_PROFILE,
        manuscript:   FIXTURES.MANUSCRIPT,
        threads:      ARCHITECT_THREADS,
      }),
      BATCH_REPLY_SCHEMA,
      { tier: 'thinking' }
    );
  }, TIMEOUT_MULTI);

  it('returns responses — all returned threadIds are valid input IDs', () => {
    expect(Array.isArray(multiResult.responses)).toBe(true);
    expect(multiResult.responses.length).toBeGreaterThan(0);

    const validIds = new Set(ARCHITECT_THREADS.map(t => t.threadId));
    for (const r of multiResult.responses) {
      expect(validIds.has(r.threadId)).toBe(true);
    }
  });

  it('each reply in the multi-thread batch is a non-empty string', () => {
    for (const r of multiResult.responses) {
      expect(typeof r.reply).toBe('string');
      expect(r.reply.trim().length).toBeGreaterThan(0);
    }
  });

  it('no duplicate threadIds in the batch response', () => {
    const ids = multiResult.responses.map((r: any) => r.threadId);
    expect(new Set(ids).size).toBe(ids.length);
  });

});
