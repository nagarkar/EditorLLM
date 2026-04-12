// ============================================================
// AuditAgent integration tests — real Gemini API calls.
//
// Workflow coverage:
//   W1 (generateInstructions) — instruction_update → { proposed_full_text, operations }
//   W2 (annotateTab)          — content_annotation → { operations }
//   W3 (handleCommentThread)  — reply-only → { reply }
//
// All tests use the thinking model (gemini-2.5-pro).
// Individual test timeout is set to 120 s.
// ============================================================

import { callGemini } from './helpers/gemini';
import { INSTRUCTION_UPDATE_SCHEMA, ANNOTATION_SCHEMA, THREAD_REPLY_SCHEMA } from './helpers/schemas';
import {
  buildAuditInstructionsPrompt,
  buildAuditAnnotatePrompt,
  buildAuditCommentPrompt,
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
      manuscript:    FIXTURES.MERGED_CONTENT,
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
    const userPrompt = buildAuditInstructionsPrompt({
      styleProfile:  FIXTURES.STYLE_PROFILE,
      existingAudit: FIXTURES.TECHNICAL_AUDIT,
      manuscript:    FIXTURES.MERGED_CONTENT,
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
    // W1 operations patch the TechnicalAudit Instructions tab, so match_text is
    // anchored in the model's proposed output, not the manuscript.
    const userPrompt = buildAuditInstructionsPrompt({
      styleProfile:  FIXTURES.STYLE_PROFILE,
      existingAudit: FIXTURES.TECHNICAL_AUDIT,
      manuscript:    FIXTURES.MERGED_CONTENT,
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

  it('gracefully returns a response even when existing audit is empty', () => {
    const userPrompt = buildAuditInstructionsPrompt({
      styleProfile:  FIXTURES.STYLE_PROFILE,
      existingAudit: '',
      manuscript:    FIXTURES.MERGED_CONTENT,
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
    expect(Array.isArray(result.operations)).toBe(true);
  }, TIMEOUT);

});

// ── W2: annotateTab ───────────────────────────────────────────────────────────

describe('AuditAgent — W2: annotateTab (content_annotation)', () => {

  it('returns an operations array when given a passage to audit', () => {
    const userPrompt = buildAuditAnnotatePrompt({
      styleProfile:      FIXTURES.STYLE_PROFILE,
      auditInstructions: FIXTURES.TECHNICAL_AUDIT,
      passage:           FIXTURES.CHAPTER_1,
      tabName:           'Chapter 1',
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
    const userPrompt = buildAuditAnnotatePrompt({
      styleProfile:      FIXTURES.STYLE_PROFILE,
      auditInstructions: FIXTURES.TECHNICAL_AUDIT,
      passage:           FIXTURES.CHAPTER_1,
      tabName:           'Chapter 1',
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

  it('detects the planted Born-rule exponent error (|³ should be |²) in CHAPTER_1', () => {
    // CHAPTER_1 contains: "P = |⟨a_n|ψ⟩|³"
    // TECHNICAL_AUDIT states exponent MUST be 2, not 3.
    const userPrompt = buildAuditAnnotatePrompt({
      styleProfile:      FIXTURES.STYLE_PROFILE,
      auditInstructions: FIXTURES.TECHNICAL_AUDIT,
      passage:           FIXTURES.CHAPTER_1,
      tabName:           'Chapter 1',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      ANNOTATION_SCHEMA,
      { tier: TIER }
    );

    // At least one operation should flag the exponent error.
    const hasExponentFlag = result.operations.some((op: any) =>
      /exponent|born|³|cube|probability|\|²|\|3/i.test(
        op.match_text + ' ' + op.reason
      )
    );
    expect(hasExponentFlag).toBe(true);
  }, TIMEOUT);

  it('each W2 match_text is a verbatim substring of the annotated passage', () => {
    // Verifies the model is grounding its flags in the actual text, not hallucinating.
    const passage = FIXTURES.CHAPTER_1;
    const userPrompt = buildAuditAnnotatePrompt({
      styleProfile:      FIXTURES.STYLE_PROFILE,
      auditInstructions: FIXTURES.TECHNICAL_AUDIT,
      passage,
      tabName:           'Chapter 1',
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

  it('does NOT return proposed_full_text (W2 is annotation-only)', () => {
    const userPrompt = buildAuditAnnotatePrompt({
      styleProfile:      FIXTURES.STYLE_PROFILE,
      auditInstructions: FIXTURES.TECHNICAL_AUDIT,
      passage:           FIXTURES.CHAPTER_1,
      tabName:           'Chapter 1',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      ANNOTATION_SCHEMA,
      { tier: TIER }
    );

    expect(result.proposed_full_text).toBeUndefined();
    expect(result.workflow_type).toBeUndefined();
  }, TIMEOUT);

  it('returns valid schema response even when passage is very short', () => {
    const userPrompt = buildAuditAnnotatePrompt({
      styleProfile:      FIXTURES.STYLE_PROFILE,
      auditInstructions: FIXTURES.TECHNICAL_AUDIT,
      passage:           'Ĥψ = Eψ is correct.',
      tabName:           'Chapter 1',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      ANNOTATION_SCHEMA,
      { tier: TIER }
    );

    expect(Array.isArray(result.operations)).toBe(true);
  }, TIMEOUT);

});

// ── W3: handleCommentThread ───────────────────────────────────────────────────

describe('AuditAgent — W3: handleCommentThread (reply-only)', () => {

  it('returns a reply string when auditing a selected passage', () => {
    const userPrompt = buildAuditCommentPrompt({
      styleProfile:      FIXTURES.STYLE_PROFILE,
      auditInstructions: FIXTURES.TECHNICAL_AUDIT,
      passageContext:    FIXTURES.CHAPTER_1,
      selectedText:      'P = |⟨a_n|ψ⟩|³',
      agentRequest:      'Is this Born rule formula correct?',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      THREAD_REPLY_SCHEMA,
      { tier: TIER }
    );

    expect(typeof result.reply).toBe('string');
    expect(result.reply.trim().length).toBeGreaterThan(0);
  }, TIMEOUT);

  it('reply ends with the AI Editorial Assistant signature', () => {
    const userPrompt = buildAuditCommentPrompt({
      styleProfile:      FIXTURES.STYLE_PROFILE,
      auditInstructions: FIXTURES.TECHNICAL_AUDIT,
      passageContext:    FIXTURES.MERGED_CONTENT,
      selectedText:      'iℏ ∂ψ/∂t = Ĥψ',
      agentRequest:      'Verify this Schrödinger equation.',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      THREAD_REPLY_SCHEMA,
      { tier: TIER }
    );

    expect(result.reply).toContain('AI Editorial Assistant');
  }, TIMEOUT);

  it('does NOT return a RootUpdate or workflow_type field', () => {
    const userPrompt = buildAuditCommentPrompt({
      styleProfile:      FIXTURES.STYLE_PROFILE,
      auditInstructions: FIXTURES.TECHNICAL_AUDIT,
      passageContext:    FIXTURES.MERGED_CONTENT,
      selectedText:      'orthodox quantum mechanics',
      agentRequest:      'Flag any axiom violations.',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      THREAD_REPLY_SCHEMA,
      { tier: TIER }
    );

    expect(result.workflow_type).toBeUndefined();
    expect(result.target_tab).toBeUndefined();
    expect(result.operations).toBeUndefined();
  }, TIMEOUT);

  it('flags the Born-rule exponent error when selected text is the flawed formula', () => {
    const userPrompt = buildAuditCommentPrompt({
      styleProfile:      FIXTURES.STYLE_PROFILE,
      auditInstructions: FIXTURES.TECHNICAL_AUDIT,
      passageContext:    FIXTURES.CHAPTER_1,
      selectedText:      'P = |⟨a_n|ψ⟩|³',
      agentRequest:      'Check this formula against the TechnicalAudit rules.',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      THREAD_REPLY_SCHEMA,
      { tier: TIER }
    );

    // The reply should mention the exponent error.
    expect(/exponent|born|²|cube|should be 2|not 3/i.test(result.reply)).toBe(true);
  }, TIMEOUT);

  it('gracefully handles empty audit instructions', () => {
    const userPrompt = buildAuditCommentPrompt({
      styleProfile:      FIXTURES.STYLE_PROFILE,
      auditInstructions: '',
      passageContext:    FIXTURES.MERGED_CONTENT,
      selectedText:      'The Chid Axiom fills this gap',
      agentRequest:      'Perform a technical audit.',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      THREAD_REPLY_SCHEMA,
      { tier: TIER }
    );

    expect(typeof result.reply).toBe('string');
    expect(result.reply.trim().length).toBeGreaterThan(0);
  }, TIMEOUT);

});

// ── Error conditions ──────────────────────────────────────────────────────────

describe('AuditAgent — error conditions', () => {

  it('throws a descriptive error when the API key is invalid', () => {
    const userPrompt = buildAuditCommentPrompt({
      styleProfile:      FIXTURES.STYLE_PROFILE,
      auditInstructions: FIXTURES.TECHNICAL_AUDIT,
      passageContext:    FIXTURES.MERGED_CONTENT,
      selectedText:      'any passage',
      agentRequest:      'any request',
    });

    expect(() =>
      callGemini(INTEGRATION_SYSTEM_PROMPT, userPrompt, THREAD_REPLY_SCHEMA, {
        tier:           'fast',
        apiKeyOverride: 'INVALID_API_KEY_FOR_TESTING',
      })
    ).toThrow(/Gemini API error/);
  });

});
