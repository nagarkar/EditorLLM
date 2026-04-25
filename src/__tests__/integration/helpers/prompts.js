"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildArchitectInstructionsPrompt = buildArchitectInstructionsPrompt;
exports.buildArchitectBatchPrompt = buildArchitectBatchPrompt;
exports.buildEarTuneInstructionsPrompt = buildEarTuneInstructionsPrompt;
exports.buildEarTuneAnnotatePrompt = buildEarTuneAnnotatePrompt;
exports.buildEarTuneBatchPrompt = buildEarTuneBatchPrompt;
exports.buildAuditInstructionsPrompt = buildAuditInstructionsPrompt;
exports.buildAuditAnnotatePrompt = buildAuditAnnotatePrompt;
exports.buildAuditBatchPrompt = buildAuditBatchPrompt;
exports.buildGeneralPurposeAgentInstructionsPrompt = buildGeneralPurposeAgentInstructionsPrompt;
exports.buildGeneralPurposeAgentBatchPrompt = buildGeneralPurposeAgentBatchPrompt;
function formatThreadsForBatch(threads) {
    return threads.map(function (t) {
        var conv = t.conversation.map(function (m) { return "[".concat(m.role, "] ").concat(m.authorName, ": ").concat(m.content); }).join('\n');
        return ("[THREAD ".concat(t.threadId, "]\n") +
            "SELECTED TEXT: ".concat(t.selectedText, "\n") +
            "CONVERSATION:\n".concat(conv, "\n") +
            "REQUEST: ".concat(t.agentRequest));
    }).join('\n\n');
}
// ── ArchitectAgent ────────────────────────────────────────────────────────────
function buildArchitectInstructionsPrompt(opts) {
    return "\nMANUSCRIPT (excerpt):\n---\n".concat(opts.manuscript.slice(0, 20000), "\n---\n\nCURRENT STYLE PROFILE (if any):\n---\n").concat(opts.styleProfile, "\n---\n\n## Instructions\n\nAnalyse the writing style above and produce a comprehensive StyleProfile.\nReturn the complete StyleProfile as plain GitHub-Flavored Markdown, starting directly\nwith the first ## heading. Do NOT wrap the response in JSON or any other format.\nRequired sections: ## Voice & Tone, ## Sentence Rhythm, ## Vocabulary Register,\n## Structural Patterns, ## Thematic Motifs. Each section MUST start with a ## heading,\nuse - bullets, and **bold** for key terms. Do NOT use plain-text section titles or\nfenced code blocks.\n").trim();
}
function buildArchitectBatchPrompt(opts) {
    return ("STYLE PROFILE:\n" +
        "---\n" +
        "".concat(opts.styleProfile.slice(0, 2000), "\n") +
        "---\n\n" +
        "MANUSCRIPT CONTEXT:\n" +
        "---\n" +
        "".concat(opts.manuscript.slice(0, 20000), "\n") +
        "---\n\n" +
        "THREADS:\n" +
        "---\n" +
        "".concat(formatThreadsForBatch(opts.threads), "\n") +
        "---\n\n" +
        "## Instructions\n\nFor each thread, analyse the selected passage for structural, motif, or voice concerns\n" +
        "relative to the manuscript and StyleProfile. End each reply with \"\u2014 AI Editorial Assistant\".\n" +
        "Return a JSON object with \"responses\": an array of {threadId, reply} entries, " +
        "one per thread you are replying to.").trim();
}
// ── EarTuneAgent ──────────────────────────────────────────────────────────────
function buildEarTuneInstructionsPrompt(opts) {
    return "\nSTYLE PROFILE:\n---\n".concat(opts.styleProfile.slice(0, 4000), "\n---\n\nCURRENT EAR-TUNE INSTRUCTIONS (if any):\n---\n").concat(opts.existingEarTune.slice(0, 2000), "\n---\n\n## Instructions\n\nGenerate an updated EarTune system prompt that:\n1. Incorporates the rhythm and cadence patterns from the StyleProfile.\n2. Provides specific rules for consonant flow, syllabic stress, and sentence-length\n   variation suitable for this manuscript.\n\nReturn the complete EarTune instructions as plain GitHub-Flavored Markdown, starting\ndirectly with the first ## heading. Do NOT wrap the response in JSON or any other format.\nRequired sections (## H2 headings): ## Overview, ## Consonant Flow Rules,\n## Syllabic Stress Rules, ## Sentence Length Variation.\nUse - bullet points for rules, **bold** for rule names. No plain-text headings.\n").trim();
}
function buildEarTuneAnnotatePrompt(opts) {
    return "\nSTYLE PROFILE:\n---\n".concat(opts.styleProfile.slice(0, 3000), "\n---\n\nEAR-TUNE INSTRUCTIONS:\n---\n").concat(opts.earTuneInstructions.slice(0, 2000), "\n---\n\nPASSAGE TO SWEEP (from tab: \"").concat(opts.tabName, "\"):\n---\n").concat(opts.passage.slice(0, 8000), "\n---\n\n## Instructions\n\nIdentify every passage with a rhythmic, phonetic, or cadence problem.\nAlso scout for \"Pronunciation Traps\" in the passage:\n- Scan for proper nouns (character/place names), technical jargon, or uncommon words (e.g., \"Chid\", \"Axiom\", \"Eigenstate\").\n- For any annotation involving a pronunciation trap, append to the end of that operation's `reason` a markdown section headed `## Phonetic Lexicon Suggestions`.\n- Under that heading, include one entry per trap in this format:\n  - Word: [Exact Spelling]\n  - Phonetic: [IPA or simple phonetic, e.g., CHID AK-see-um]\n  - Context: [Short phrase using the word]\n\nReturn a JSON object with:\n- operations: one per problem found. Each must have:\n    - match_text: verbatim 3\u20134-word phrase from the passage above\n    - reason: description of the issue and suggested improvement; when relevant, end with the `## Phonetic Lexicon Suggestions` section described above\n").trim();
}
function buildEarTuneBatchPrompt(opts) {
    var passageSection = opts.passageContext
        ? "## Passage Context\n\n".concat(opts.passageContext.slice(0, 4000), "\n\n\n")
        : '';
    return ("STYLE PROFILE:\n" +
        "---\n" +
        "".concat(opts.styleProfile.slice(0, 2000), "\n") +
        "---\n\n" +
        "EAR-TUNE INSTRUCTIONS:\n" +
        "---\n" +
        "".concat(opts.earTuneInstructions.slice(0, 2000), "\n") +
        "---\n\n" +
        "".concat(passageSection) +
        "THREADS:\n" +
        "---\n" +
        "".concat(formatThreadsForBatch(opts.threads), "\n") +
        "---\n\n" +
        "## Instructions\n\nFor each thread, analyse the selected text for rhythmic, phonetic, and cadence issues\n" +
        "per the Ear-Tune instructions. End each reply with \"\u2014 AI Editorial Assistant\".\n" +
        "Return a JSON object with \"responses\": an array of {threadId, reply} entries, " +
        "one per thread you are replying to.").trim();
}
// ── AuditAgent ────────────────────────────────────────────────────────────────
function buildAuditInstructionsPrompt(opts) {
    return "\nSTYLE PROFILE:\n---\n".concat(opts.styleProfile.slice(0, 3000), "\n---\n\nCURRENT TECHNICAL AUDIT INSTRUCTIONS (if any):\n---\n").concat(opts.existingAudit.slice(0, 2000), "\n---\n\nMANUSCRIPT SAMPLE (for principle extraction):\n---\n").concat(opts.manuscript.slice(0, 20000), "\n---\n\n## Instructions\n\nGenerate a comprehensive TechnicalAudit system prompt that:\n1. Lists all core axioms and foundational principles as stated in the manuscript.\n2. Defines technical notation and formatting requirements for this document.\n3. Specifies the terminology and reference systems in use.\n4. Provides specific audit checklist items derived from the manuscript.\n\nReturn the complete TechnicalAudit instructions as plain GitHub-Flavored Markdown, starting\ndirectly with the first ## heading. Do NOT wrap the response in JSON or any other format.\nRequired sections (## H2 headings): ## Core Axioms, ## Foundational Principles,\n## Technical Notation, ## Terminology & Reference Systems, ## Audit Checklist.\nUse - bullet points, **bold** for axiom names and key terms. No plain headings.\n").trim();
}
function buildAuditAnnotatePrompt(opts) {
    return "\nSTYLE PROFILE:\n---\n".concat(opts.styleProfile.slice(0, 2000), "\n---\n\nTECHNICAL AUDIT INSTRUCTIONS:\n---\n").concat(opts.auditInstructions.slice(0, 3000), "\n---\n\nPASSAGE TO AUDIT (from tab: \"").concat(opts.tabName, "\"):\n---\n").concat(opts.passage.slice(0, 8000), "\n---\n\n## Instructions\n\nPerform a full technical audit. Check every factual claim against the\nmanuscript's established framework and core axioms, all technical notations\nfor correctness, and verify terminology is consistent with established definitions.\n\nReturn a JSON object with:\n- operations: one per issue found. Each must have:\n    - match_text: verbatim 3\u20134-word phrase from the passage above\n    - reason: specific principle, definition, or notation violated, plus suggested correction\n").trim();
}
function buildAuditBatchPrompt(opts) {
    var passageSection = opts.passageContext
        ? "## Passage Context\n\n".concat(opts.passageContext.slice(0, 4000), "\n\n\n")
        : '';
    return ("STYLE PROFILE:\n" +
        "---\n" +
        "".concat(opts.styleProfile.slice(0, 2000), "\n") +
        "---\n\n" +
        "TECHNICAL AUDIT INSTRUCTIONS:\n" +
        "---\n" +
        "".concat(opts.auditInstructions.slice(0, 3000), "\n") +
        "---\n\n" +
        "".concat(passageSection) +
        "THREADS:\n" +
        "---\n" +
        "".concat(formatThreadsForBatch(opts.threads), "\n") +
        "---\n\n" +
        "## Instructions\n\nFor each thread, perform a targeted technical audit of the selected passage.\n" +
        "Identify any axiom violations, LaTeX caption issues, or constant errors.\n" +
        "End each reply with \"\u2014 AI Editorial Assistant\".\n" +
        "Return a JSON object with \"responses\": an array of {threadId, reply} entries, " +
        "one per thread you are replying to.").trim();
}
// ── GeneralPurposeAgent ──────────────────────────────────────────────────────────────
function buildGeneralPurposeAgentInstructionsPrompt(opts) {
    return "\nSTYLE PROFILE:\n---\n".concat(opts.styleProfile.slice(0, 3000), "\n---\n\nCURRENT GENERAL PURPOSE INSTRUCTIONS (if any):\n---\n").concat(opts.existingInstructions.slice(0, 2000), "\n---\n\n## Instructions\n\nGenerate an updated General Purpose Instructions system prompt that guides the AI to\nrespond to in-document \"@AI\" comment threads in a voice consistent with this\nmanuscript's StyleProfile.\n\nReturn the complete instructions as plain GitHub-Flavored Markdown, starting directly\nwith the first ## heading. Do NOT wrap the response in JSON or any other format.\nRequired sections (## H2 headings): ## Response Style, ## Scope, ## Sign-off, ## Example Thread.\nUse - bullet points for rules, **bold** for key constraints.\nInclude a concrete example exchange in ## Example Thread using > blockquotes.\n").trim();
}
function buildGeneralPurposeAgentBatchPrompt(opts) {
    var anchorSection = opts.anchorContent
        ? "## Anchor Passage\n\n".concat(opts.anchorContent, "\n\n\n")
        : '';
    return ("".concat(anchorSection) +
        "THREADS:\n" +
        "---\n" +
        "".concat(formatThreadsForBatch(opts.threads), "\n") +
        "---\n\n" +
        "## Instructions\n\nFor each thread, respond to the request concisely and grounded in the passage context.\n" +
        "End each reply with \"\u2014 AI Editorial Assistant\".\n" +
        "Return a JSON object with \"responses\": an array of {threadId, reply} entries, " +
        "one per thread you are replying to.").trim();
}
