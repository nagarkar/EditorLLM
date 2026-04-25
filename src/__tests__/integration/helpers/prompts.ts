// ============================================================
// Prompt builders for integration tests.
//
// Canonical implementation: src/PromptBuilders.ts (global PromptBuilders).
// Production agents call those functions; this file should stay in lockstep.
//
// TODO: Load dist/PromptBuilders.js in integration setup and delegate these
// exports to global.PromptBuilders.* to remove duplication entirely.
//
// MAINTENANCE CONTRACT: If PromptBuilders.ts changes, update this file or
// switch to delegation — integration tests must match production strings.
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
  styleProfile: string;
}): string {
  return `
MANUSCRIPT (excerpt):
---
${opts.manuscript.slice(0, 20000)}
---

CURRENT STYLE PROFILE (if any):
---
${opts.styleProfile}
---

## Instructions\n\nAnalyse the writing style above and produce a comprehensive StyleProfile.
Return the complete StyleProfile as plain GitHub-Flavored Markdown, starting directly
with the first ## heading. Do NOT wrap the response in JSON or any other format.
Required sections: ## Voice & Tone, ## Sentence Rhythm, ## Vocabulary Register,
## Structural Patterns, ## Thematic Motifs. Each section MUST start with a ## heading,
use - bullets, and **bold** for key terms. Do NOT use plain-text section titles or
fenced code blocks.
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
    `## Instructions\n\nFor each thread, analyse the selected passage for structural, motif, or voice concerns\n` +
    `relative to the manuscript and StyleProfile. End each reply with "— AI Editorial Assistant".\n` +
    `Return a JSON object with "responses": an array of {threadId, reply} entries, ` +
    `one per thread you are replying to.`
  ).trim();
}

// ── EarTuneAgent ──────────────────────────────────────────────────────────────

export function buildEarTuneInstructionsPrompt(opts: {
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

## Instructions\n\nGenerate an updated EarTune system prompt that:
1. Incorporates the rhythm and cadence patterns from the StyleProfile.
2. Provides specific rules for consonant flow, syllabic stress, and sentence-length
   variation suitable for this manuscript.

Return the complete EarTune instructions as plain GitHub-Flavored Markdown, starting
directly with the first ## heading. Do NOT wrap the response in JSON or any other format.
Required sections (## H2 headings): ## Overview, ## Consonant Flow Rules,
## Syllabic Stress Rules, ## Sentence Length Variation.
Use - bullet points for rules, **bold** for rule names. No plain-text headings.
`.trim();
}

export function buildEarTuneAnnotatePrompt(opts: {
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

## Instructions\n\nIdentify every passage with a rhythmic, phonetic, or cadence problem.
Also scout for "Pronunciation Traps" in the passage:
- Scan for proper nouns (character/place names), technical jargon, or uncommon words (e.g., "Chid", "Axiom", "Eigenstate").
- For any annotation involving a pronunciation trap, append to the end of that operation's \`reason\` a markdown section headed \`## Phonetic Lexicon Suggestions\`.
- Under that heading, include one entry per trap in this format:
  - Word: [Exact Spelling]
  - Phonetic: [IPA or simple phonetic, e.g., CHID AK-see-um]
  - Context: [Short phrase using the word]

Return a JSON object with:
- operations: one per problem found. Each must have:
    - match_text: verbatim 3–4-word phrase from the passage above
    - reason: description of the issue and suggested improvement; when relevant, end with the \`## Phonetic Lexicon Suggestions\` section described above
`.trim();
}

export function buildEarTuneBatchPrompt(opts: {
  styleProfile:        string;
  earTuneInstructions: string;
  passageContext:      string;
  threads:             TestThread[];
}): string {
  const passageSection = opts.passageContext
    ? `## Passage Context\n\n${opts.passageContext.slice(0, 4000)}\n\n\n`
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
    `## Instructions\n\nFor each thread, analyse the selected text for rhythmic, phonetic, and cadence issues\n` +
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

MANUSCRIPT SAMPLE (for principle extraction):
---
${opts.manuscript.slice(0, 20000)}
---

## Instructions\n\nGenerate a comprehensive TechnicalAudit system prompt that:
1. Lists all core axioms and foundational principles as stated in the manuscript.
2. Defines technical notation and formatting requirements for this document.
3. Specifies the terminology and reference systems in use.
4. Provides specific audit checklist items derived from the manuscript.

Return the complete TechnicalAudit instructions as plain GitHub-Flavored Markdown, starting
directly with the first ## heading. Do NOT wrap the response in JSON or any other format.
Required sections (## H2 headings): ## Core Axioms, ## Foundational Principles,
## Technical Notation, ## Terminology & Reference Systems, ## Audit Checklist.
Use - bullet points, **bold** for axiom names and key terms. No plain headings.
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

## Instructions\n\nPerform a full technical audit. Check every factual claim against the
manuscript's established framework and core axioms, all technical notations
for correctness, and verify terminology is consistent with established definitions.

Return a JSON object with:
- operations: one per issue found. Each must have:
    - match_text: verbatim 3–4-word phrase from the passage above
    - reason: specific principle, definition, or notation violated, plus suggested correction
`.trim();
}

export function buildAuditBatchPrompt(opts: {
  styleProfile:      string;
  auditInstructions: string;
  passageContext:    string;
  threads:           TestThread[];
}): string {
  const passageSection = opts.passageContext
    ? `## Passage Context\n\n${opts.passageContext.slice(0, 4000)}\n\n\n`
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
    `## Instructions\n\nFor each thread, perform a targeted technical audit of the selected passage.\n` +
    `Identify any axiom violations, LaTeX caption issues, or constant errors.\n` +
    `End each reply with "— AI Editorial Assistant".\n` +
    `Return a JSON object with "responses": an array of {threadId, reply} entries, ` +
    `one per thread you are replying to.`
  ).trim();
}

// ── GeneralPurposeAgent ──────────────────────────────────────────────────────────────

export function buildGeneralPurposeAgentInstructionsPrompt(opts: {
  styleProfile:         string;
  existingInstructions: string;
}): string {
  return `
STYLE PROFILE:
---
${opts.styleProfile.slice(0, 3000)}
---

CURRENT GENERAL PURPOSE INSTRUCTIONS (if any):
---
${opts.existingInstructions.slice(0, 2000)}
---

## Instructions

Generate an updated General Purpose Instructions system prompt that guides the AI to
respond to in-document "@AI" comment threads in a voice consistent with this
manuscript's StyleProfile.

Return the complete instructions as plain GitHub-Flavored Markdown, starting directly
with the first ## heading. Do NOT wrap the response in JSON or any other format.
Required sections (## H2 headings): ## Response Style, ## Scope, ## Sign-off, ## Example Thread.
Use - bullet points for rules, **bold** for key constraints.
Include a concrete example exchange in ## Example Thread using > blockquotes.
`.trim();
}

export function buildGeneralPurposeAgentBatchPrompt(opts: {
  anchorContent: string;
  threads:       TestThread[];
}): string {
  const anchorSection = opts.anchorContent
    ? `## Anchor Passage\n\n${opts.anchorContent}\n\n\n`
    : '';

  return (
    `${anchorSection}` +
    `THREADS:\n` +
    `---\n` +
    `${formatThreadsForBatch(opts.threads)}\n` +
    `---\n\n` +
    `## Instructions\n\nFor each thread, respond to the request concisely and grounded in the passage context.\n` +
    `End each reply with "— AI Editorial Assistant".\n` +
    `Return a JSON object with "responses": an array of {threadId, reply} entries, ` +
    `one per thread you are replying to.`
  ).trim();
}
