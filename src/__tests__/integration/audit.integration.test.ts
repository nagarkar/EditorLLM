// ============================================================
// AuditAgent integration tests — real Gemini API calls.
//
// PURPOSE
// -------
// Validates the Gemini prompt↔model contract for AuditAgent: given
// technical audit prompts and structured JSON schemas, the model
// returns correct shapes, detects planted errors, and grounds its
// annotations in verbatim passage text. Tests call Gemini REST
// directly from Node — no GAS deployment required.
//
// WORKFLOW COVERAGE (see BaseAgent for workflow definitions)
// ----------------------------------------------------------
//   W1 (generateInstructions)
//     • Sends StyleProfile + manuscript + existing audit instructions →
//       model produces a TechnicalAudit prompt with proposed_full_text.
//     • Schema: INSTRUCTION_UPDATE_SCHEMA → { proposed_full_text }
//     • Edge cases: empty existing audit, empty manuscript.
//
//   W2 (annotateTab)
//     • Sends a passage to audit → model returns { operations: [{match_text, reason}] }
//     • Schema: ANNOTATION_SCHEMA → { operations }
//     • Key assertions:
//       - Detects planted Born-rule exponent error (|³ should be |²)
//       - Every match_text is a verbatim substring of the passage (grounding)
//       - Does NOT return proposed_full_text (W2 is annotation-only)
//       - Handles very short passages gracefully
//
//   W3 (handleCommentThreads)
//     • Single-thread: validates threadId, non-empty reply, signature,
//       absence of mutation fields, and Born-rule detection in reply text.
//     • Edge case: empty audit instructions still produce a valid reply.
//
// PLANTED ERRORS (in fixtures/testDocument.ts)
// ---------------------------------------------
//   • CHAPTER_1 contains P = |⟨a_n|ψ⟩|³ — exponent should be 2 per Born rule.
//   • TECHNICAL_AUDIT explicitly states "exponent MUST be 2, not 3".
//   • Both W2 and W3 tests assert the model detects this error.
//
// EXECUTION MODEL
// ---------------
//   • Run via: npm run test:integration
//   • Requires: GEMINI_API_KEY in .env.integration
//   • Model tier: thinking (slower but more reliable for technical reasoning)
//   • Timeout: 120s per test
// ============================================================

import { callGemini } from './helpers/gemini';
import { INSTRUCTION_UPDATE_SCHEMA, ANNOTATION_SCHEMA, BATCH_REPLY_SCHEMA } from './helpers/schemas';
import {
  TestThread,
  buildAuditInstructionsPrompt,
  buildAuditAnnotatePrompt,
  buildAuditBatchPrompt,
} from './helpers/prompts';
import { FIXTURES, INTEGRATION_SYSTEM_PROMPT } from './fixtures/testDocument';

const TIER = 'thinking' as const;
const TIMEOUT = 120000;

// ── W1: generateInstructions ──────────────────────────────────────────────────

describe('AuditAgent — W1: generateInstructions (instruction_update)', () => {

  it('produces proposed_full_text and operations from StyleProfile and manuscript', () => {
    const userPrompt = buildAuditInstructionsPrompt({
      styleProfile:  FIXTURES.STYLE_PROFILE,
      existingAudit: FIXTURES.TECHNICAL_AUDIT,
      manuscript:    FIXTURES.MANUSCRIPT,
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



  it('gracefully returns a response even when existing audit is empty', () => {
    const userPrompt = buildAuditInstructionsPrompt({
      styleProfile:  FIXTURES.STYLE_PROFILE,
      existingAudit: '',
      manuscript:    FIXTURES.MANUSCRIPT,
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      INSTRUCTION_UPDATE_SCHEMA,
      { tier: TIER }
    );

    expect(typeof result.proposed_full_text).toBe('string');
  }, TIMEOUT);

  it('gracefully returns a response even when manuscript is empty', () => {
    const userPrompt = buildAuditInstructionsPrompt({
      styleProfile:  FIXTURES.STYLE_PROFILE,
      existingAudit: FIXTURES.TECHNICAL_AUDIT,
      manuscript:    '',
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

describe('AuditAgent — W2: annotateTab (content_annotation)', () => {

  // Five tests below assert different properties of the same CHAPTER_1 response.
  // One shared beforeAll call replaces five identical callGemini() invocations.
  let w2Result: any;

  beforeAll(() => {
    w2Result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      buildAuditAnnotatePrompt({
        styleProfile:      FIXTURES.STYLE_PROFILE,
        auditInstructions: FIXTURES.TECHNICAL_AUDIT,
        passage:           FIXTURES.CHAPTER_1,
        tabName:           'Chapter 1',
      }),
      ANNOTATION_SCHEMA,
      { tier: TIER }
    );
  }, TIMEOUT);

  it('returns an operations array when given a passage to audit', () => {
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

  it('detects the planted Born-rule exponent error (|³ should be |²) in CHAPTER_1', () => {
    // CHAPTER_1 contains: "P = |⟨a_n|ψ⟩|³"
    // TECHNICAL_AUDIT states exponent MUST be 2, not 3.
    const hasExponentFlag = w2Result.operations.some((op: any) =>
      /exponent|born|³|cube|probability|\|²|\|3/i.test(
        op.match_text + ' ' + op.reason
      )
    );
    expect(hasExponentFlag).toBe(true);
  });

  it('each W2 match_text is a verbatim substring of the annotated passage', () => {
    // Verifies the model is grounding its flags in the actual text, not hallucinating.
    const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const normalizedPassage = normalize(FIXTURES.CHAPTER_1);
    for (const op of w2Result.operations) {
      const found = normalize(op.match_text).length > 0 &&
        normalizedPassage.includes(normalize(op.match_text));
      expect(found).toBe(true);
    }
  });

  it('does NOT return proposed_full_text (W2 is annotation-only)', () => {
    expect(w2Result.proposed_full_text).toBeUndefined();
    expect(w2Result.workflow_type).toBeUndefined();
  });

  it('returns valid schema response even when passage is very short', () => {
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      buildAuditAnnotatePrompt({
        styleProfile:      FIXTURES.STYLE_PROFILE,
        auditInstructions: FIXTURES.TECHNICAL_AUDIT,
        passage:           'Ĥψ = Eψ is correct.',
        tabName:           'Chapter 1',
      }),
      ANNOTATION_SCHEMA,
      { tier: TIER }
    );

    expect(Array.isArray(result.operations)).toBe(true);
  }, TIMEOUT);

});

// ── W3: handleCommentThreads — single-thread batch ───────────────────────────

describe('AuditAgent — W3: single-thread batch', () => {

  it('returns a responses array with a valid threadId and non-empty reply', () => {
    const thread: TestThread = {
      threadId:     'audit-thread-001',
      selectedText: 'P = |⟨a_n|ψ⟩|³',
      agentRequest: 'Is this Born rule formula correct?',
      conversation: [{ role: 'User', authorName: 'Author', content: '@audit Is this Born rule correct?' }],
    };
    const userPrompt = buildAuditBatchPrompt({
      styleProfile:      FIXTURES.STYLE_PROFILE,
      auditInstructions: FIXTURES.TECHNICAL_AUDIT,
      passageContext:    FIXTURES.CHAPTER_1,
      threads:           [thread],
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
      threadId:     'audit-thread-002',
      selectedText: 'iℏ ∂ψ/∂t = Ĥψ',
      agentRequest: 'Verify this Schrödinger equation.',
      conversation: [{ role: 'User', authorName: 'Author', content: '@audit Verify this equation.' }],
    };
    const userPrompt = buildAuditBatchPrompt({
      styleProfile:      FIXTURES.STYLE_PROFILE,
      auditInstructions: FIXTURES.TECHNICAL_AUDIT,
      passageContext:    FIXTURES.MANUSCRIPT,
      threads:           [thread],
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
      threadId:     'audit-thread-003',
      selectedText: 'orthodox quantum mechanics',
      agentRequest: 'Flag any axiom violations.',
      conversation: [{ role: 'User', authorName: 'Author', content: '@audit Flag violations.' }],
    };
    const userPrompt = buildAuditBatchPrompt({
      styleProfile:      FIXTURES.STYLE_PROFILE,
      auditInstructions: FIXTURES.TECHNICAL_AUDIT,
      passageContext:    FIXTURES.MANUSCRIPT,
      threads:           [thread],
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

  it('flags the Born-rule exponent error when selected text is the flawed formula', () => {
    const thread: TestThread = {
      threadId:     'audit-thread-004',
      selectedText: 'P = |⟨a_n|ψ⟩|³',
      agentRequest: 'Check this formula against the TechnicalAudit rules.',
      conversation: [{ role: 'User', authorName: 'Author', content: '@audit Check this formula.' }],
    };
    const userPrompt = buildAuditBatchPrompt({
      styleProfile:      FIXTURES.STYLE_PROFILE,
      auditInstructions: FIXTURES.TECHNICAL_AUDIT,
      passageContext:    FIXTURES.CHAPTER_1,
      threads:           [thread],
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      BATCH_REPLY_SCHEMA,
      { tier: TIER }
    );

    // The reply should mention the exponent error.
    expect(/exponent|born|²|cube|should be 2|not 3/i.test(result.responses[0].reply)).toBe(true);
  }, TIMEOUT);

  it('gracefully handles empty audit instructions', () => {
    const thread: TestThread = {
      threadId:     'audit-thread-005',
      selectedText: 'The Chid Axiom fills this gap',
      agentRequest: 'Perform a technical audit.',
      conversation: [{ role: 'User', authorName: 'Author', content: '@audit Technical audit.' }],
    };
    const userPrompt = buildAuditBatchPrompt({
      styleProfile:      FIXTURES.STYLE_PROFILE,
      auditInstructions: '',
      passageContext:    FIXTURES.MANUSCRIPT,
      threads:           [thread],
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
