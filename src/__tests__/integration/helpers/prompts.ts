// ============================================================
// Prompt builders for integration tests.
//
// These reproduce the exact user-prompt strings from each agent's
// handleCommentThreads / annotateTab / generateInstructions methods.
//
// MAINTENANCE CONTRACT: If any agent prompt changes in production,
// the corresponding builder here must be updated to match.
// A divergence means integration tests are no longer testing the
// real agent prompts.
// ============================================================

// ── Shared thread formatter ───────────────────────────────────────────────────

export interface TestThread {
  threadId:     string;
  selectedText: string;
  agentRequest: string;
  conversation: Array<{ role: 'User' | 'AI'; authorName: string; content: string }>;
}

function formatThreadsForBatch(threads: TestThread[]): string {
  return threads.map(t => {
    const conv = t.conversation.map(m => `[${m.role}] ${m.authorName}: ${m.content}`).join('\n');
    return (
      `[THREAD ${t.threadId}]\n` +
      `SELECTED TEXT: ${t.selectedText}\n` +
      `CONVERSATION:\n${conv}\n` +
      `REQUEST: ${t.agentRequest}`
    );
  }).join('\n\n');
}

// ── ArchitectAgent ────────────────────────────────────────────────────────────

export function buildArchitectInstructionsPrompt(opts: {
  manuscript: string;
}): string {
  return `
MANUSCRIPT (excerpt):
---
${opts.manuscript.slice(0, 20000)}
---

Analyse the writing style above and produce a comprehensive StyleProfile.
Return a JSON object with:
- proposed_full_text: your full StyleProfile document — MUST be valid
  GitHub-Flavored Markdown with the following structure:
    ## Voice & Tone
    ## Sentence Rhythm
    ## Vocabulary Register
    ## Structural Patterns
    ## Thematic Motifs
  Each section MUST start with a ## heading, use - bullets, and **bold** for
  key terms. Do NOT use plain-text section titles or fenced code blocks.
- operations: one per major style dimension updated (voice, rhythm, vocabulary,
  structure, motifs). Each match_text must be a verbatim 3–4-word phrase from
  proposed_full_text.
`.trim();
}

export function buildArchitectBatchPrompt(opts: {
  styleProfile: string;
  manuscript:   string;
  threads:      TestThread[];
}): string {
  return (
    `STYLE PROFILE:\n` +
    `---\n` +
    `${opts.styleProfile.slice(0, 2000)}\n` +
    `---\n\n` +
    `MANUSCRIPT CONTEXT:\n` +
    `---\n` +
    `${opts.manuscript.slice(0, 20000)}\n` +
    `---\n\n` +
    `THREADS:\n` +
    `---\n` +
    `${formatThreadsForBatch(opts.threads)}\n` +
    `---\n\n` +
    `For each thread, analyse the selected passage for structural, motif, or voice concerns\n` +
    `relative to the manuscript and StyleProfile. End each reply with "— AI Editorial Assistant".\n` +
    `Return a JSON object with "responses": an array of {threadId, reply} entries, ` +
    `one per thread you are replying to.`
  ).trim();
}

// ── StylistAgent ──────────────────────────────────────────────────────────────

export function buildStylistInstructionsPrompt(opts: {
  styleProfile:    string;
  existingEarTune: string;
}): string {
  return `
STYLE PROFILE:
---
${opts.styleProfile.slice(0, 4000)}
---

CURRENT EAR-TUNE INSTRUCTIONS (if any):
---
${opts.existingEarTune.slice(0, 2000)}
---

Generate an updated EarTune system prompt that:
1. Incorporates the rhythm and cadence patterns from the StyleProfile.
2. Provides specific rules for consonant flow, syllabic stress, and sentence-length
   variation suitable for this manuscript.

Return a JSON object with:
- proposed_full_text: the complete new EarTune instructions — MUST be valid
  GitHub-Flavored Markdown. Required sections (## H2 headings):
    ## Overview
    ## Consonant Flow Rules
    ## Syllabic Stress Rules
    ## Sentence Length Variation
  Use - bullet points for rules, **bold** for rule names. No plain-text headings.
- operations: one per section being changed or added, each with a verbatim
  match_text from proposed_full_text and a reason.
`.trim();
}

export function buildStylistAnnotatePrompt(opts: {
  styleProfile:        string;
  earTuneInstructions: string;
  passage:             string;
  tabName:             string;
}): string {
  return `
STYLE PROFILE:
---
${opts.styleProfile.slice(0, 3000)}
---

EAR-TUNE INSTRUCTIONS:
---
${opts.earTuneInstructions.slice(0, 2000)}
---

PASSAGE TO SWEEP (from tab: "${opts.tabName}"):
---
${opts.passage.slice(0, 8000)}
---

Identify every passage with a rhythmic, phonetic, or cadence problem.
Return a JSON object with:
- operations: one per problem found. Each must have:
    - match_text: verbatim 3–4-word phrase from the passage above
    - reason: description of the issue and suggested improvement
`.trim();
}

export function buildStylistBatchPrompt(opts: {
  styleProfile:        string;
  earTuneInstructions: string;
  passageContext:      string;
  threads:             TestThread[];
}): string {
  const passageSection = opts.passageContext
    ? `PASSAGE CONTEXT:\n---\n${opts.passageContext.slice(0, 4000)}\n---\n\n`
    : '';

  return (
    `STYLE PROFILE:\n` +
    `---\n` +
    `${opts.styleProfile.slice(0, 2000)}\n` +
    `---\n\n` +
    `EAR-TUNE INSTRUCTIONS:\n` +
    `---\n` +
    `${opts.earTuneInstructions.slice(0, 2000)}\n` +
    `---\n\n` +
    `${passageSection}` +
    `THREADS:\n` +
    `---\n` +
    `${formatThreadsForBatch(opts.threads)}\n` +
    `---\n\n` +
    `For each thread, analyse the selected text for rhythmic, phonetic, and cadence issues\n` +
    `per the Ear-Tune instructions. End each reply with "— AI Editorial Assistant".\n` +
    `Return a JSON object with "responses": an array of {threadId, reply} entries, ` +
    `one per thread you are replying to.`
  ).trim();
}

// ── AuditAgent ────────────────────────────────────────────────────────────────

export function buildAuditInstructionsPrompt(opts: {
  styleProfile:  string;
  existingAudit: string;
  manuscript:    string;
}): string {
  return `
STYLE PROFILE:
---
${opts.styleProfile.slice(0, 3000)}
---

CURRENT TECHNICAL AUDIT INSTRUCTIONS (if any):
---
${opts.existingAudit.slice(0, 2000)}
---

MANUSCRIPT SAMPLE (for axiom extraction):
---
${opts.manuscript.slice(0, 6000)}
---

Generate a comprehensive TechnicalAudit system prompt that:
1. Lists all Chid Axioms and physical principles as stated in the manuscript.
2. Defines LaTeX caption requirements for this document.
3. Specifies the unit system and physical constants in use.
4. Provides specific audit checklist items derived from the manuscript.

Return a JSON object with:
- proposed_full_text: the complete new TechnicalAudit instructions — MUST be
  valid GitHub-Flavored Markdown. Required sections (## H2 headings):
    ## Chid Axioms
    ## Physical Principles
    ## LaTeX Requirements
    ## Unit System & Constants
    ## Audit Checklist
  Use - bullet points, **bold** for axiom names and constants. No plain headings.
- operations: one per major section being added or revised, each with a verbatim
  match_text from proposed_full_text and a reason.
`.trim();
}

export function buildAuditAnnotatePrompt(opts: {
  styleProfile:      string;
  auditInstructions: string;
  passage:           string;
  tabName:           string;
}): string {
  return `
STYLE PROFILE:
---
${opts.styleProfile.slice(0, 2000)}
---

TECHNICAL AUDIT INSTRUCTIONS:
---
${opts.auditInstructions.slice(0, 3000)}
---

PASSAGE TO AUDIT (from tab: "${opts.tabName}"):
---
${opts.passage.slice(0, 8000)}
---

Perform a full technical audit. Check every claim against the Chid Axiom,
all equations for valid LaTeX captions, and all physical constants for
correct SI values and units.

Return a JSON object with:
- operations: one per issue found. Each must have:
    - match_text: verbatim 3–4-word phrase from the passage above
    - reason: specific axiom, constant, or caption rule violated, plus suggested correction
`.trim();
}

export function buildAuditBatchPrompt(opts: {
  styleProfile:      string;
  auditInstructions: string;
  passageContext:    string;
  threads:           TestThread[];
}): string {
  const passageSection = opts.passageContext
    ? `PASSAGE CONTEXT:\n---\n${opts.passageContext.slice(0, 4000)}\n---\n\n`
    : '';

  return (
    `STYLE PROFILE:\n` +
    `---\n` +
    `${opts.styleProfile.slice(0, 2000)}\n` +
    `---\n\n` +
    `TECHNICAL AUDIT INSTRUCTIONS:\n` +
    `---\n` +
    `${opts.auditInstructions.slice(0, 3000)}\n` +
    `---\n\n` +
    `${passageSection}` +
    `THREADS:\n` +
    `---\n` +
    `${formatThreadsForBatch(opts.threads)}\n` +
    `---\n\n` +
    `For each thread, perform a targeted technical audit of the selected passage.\n` +
    `Identify any axiom violations, LaTeX caption issues, or constant errors.\n` +
    `End each reply with "— AI Editorial Assistant".\n` +
    `Return a JSON object with "responses": an array of {threadId, reply} entries, ` +
    `one per thread you are replying to.`
  ).trim();
}

// ── CommentAgent ──────────────────────────────────────────────────────────────

export function buildCommentAgentInstructionsPrompt(opts: {
  styleProfile:         string;
  existingInstructions: string;
}): string {
  return `
STYLE PROFILE:
---
${opts.styleProfile.slice(0, 3000)}
---

CURRENT COMMENT INSTRUCTIONS (if any):
---
${opts.existingInstructions.slice(0, 2000)}
---

Generate an updated Comment Instructions system prompt that guides the AI to
respond to in-document "@AI" comment threads in a voice consistent with this
manuscript's StyleProfile.

Return a JSON object with:
- proposed_full_text: the complete new Comment Instructions — MUST be valid
  GitHub-Flavored Markdown. Required sections (## H2 headings):
    ## Response Style
    ## Scope
    ## Sign-off
    ## Example Thread
  Use - bullet points for rules, **bold** for key constraints. Every section
  must start with a ## heading. Include a concrete example exchange in
  ## Example Thread using > blockquotes.
- operations: one per section being added or changed, each with a verbatim
  match_text from proposed_full_text and a reason.
`.trim();
}

export function buildCommentAgentBatchPrompt(opts: {
  anchorContent: string;
  threads:       TestThread[];
}): string {
  const anchorSection = opts.anchorContent
    ? `ANCHOR PASSAGE:\n---\n${opts.anchorContent}\n---\n\n`
    : '';

  return (
    `${anchorSection}` +
    `THREADS:\n` +
    `---\n` +
    `${formatThreadsForBatch(opts.threads)}\n` +
    `---\n\n` +
    `For each thread, respond to the request concisely and grounded in the passage context.\n` +
    `End each reply with "— AI Editorial Assistant".\n` +
    `Return a JSON object with "responses": an array of {threadId, reply} entries, ` +
    `one per thread you are replying to.`
  ).trim();
}
