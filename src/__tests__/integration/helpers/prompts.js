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
    return "\nMANUSCRIPT (excerpt):\n---\n".concat(opts.manuscript.slice(0, 20000), "\n---\n\nCURRENT STYLE PROFILE (if any):\n---\n").concat(opts.styleProfile, "\n---\n\n## Instructions\n\nAnalyse the writing style above and produce a comprehensive StyleProfile.\nReturn a JSON object with:\n- proposed_full_text: your full StyleProfile document \u2014 MUST be valid\n  GitHub-Flavored Markdown with the following structure:\n    ## Voice & Tone\n    ## Sentence Rhythm\n    ## Vocabulary Register\n    ## Structural Patterns\n    ## Thematic Motifs\n  Each section MUST start with a ## heading, use - bullets, and **bold** for\n  key terms. Do NOT use plain-text section titles or fenced code blocks.\n- operations: one per major style dimension updated (voice, rhythm, vocabulary,\n  structure, motifs). Each match_text must be a verbatim 3\u20134-word phrase from\n  proposed_full_text.\n").trim();
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
    return "\nSTYLE PROFILE:\n---\n".concat(opts.styleProfile.slice(0, 4000), "\n---\n\nCURRENT EAR-TUNE INSTRUCTIONS (if any):\n---\n").concat(opts.existingEarTune.slice(0, 2000), "\n---\n\n## Instructions\n\nGenerate an updated EarTune system prompt that:\n1. Incorporates the rhythm and cadence patterns from the StyleProfile.\n2. Provides specific rules for consonant flow, syllabic stress, and sentence-length\n   variation suitable for this manuscript.\n\nReturn a JSON object with:\n- proposed_full_text: the complete new EarTune instructions \u2014 MUST be valid\n  GitHub-Flavored Markdown. Required sections (## H2 headings):\n    ## Overview\n    ## Consonant Flow Rules\n    ## Syllabic Stress Rules\n    ## Sentence Length Variation\n  Use - bullet points for rules, **bold** for rule names. No plain-text headings.\n- operations: one per section being changed or added, each with a verbatim\n  match_text from proposed_full_text and a reason.\n").trim();
}
function buildEarTuneAnnotatePrompt(opts) {
    return "\nSTYLE PROFILE:\n---\n".concat(opts.styleProfile.slice(0, 3000), "\n---\n\nEAR-TUNE INSTRUCTIONS:\n---\n").concat(opts.earTuneInstructions.slice(0, 2000), "\n---\n\nPASSAGE TO SWEEP (from tab: \"").concat(opts.tabName, "\"):\n---\n").concat(opts.passage.slice(0, 8000), "\n---\n\n## Instructions\n\nIdentify every passage with a rhythmic, phonetic, or cadence problem.\nReturn a JSON object with:\n- operations: one per problem found. Each must have:\n    - match_text: verbatim 3\u20134-word phrase from the passage above\n    - reason: description of the issue and suggested improvement\n").trim();
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
    return "\nSTYLE PROFILE:\n---\n".concat(opts.styleProfile.slice(0, 3000), "\n---\n\nCURRENT TECHNICAL AUDIT INSTRUCTIONS (if any):\n---\n").concat(opts.existingAudit.slice(0, 2000), "\n---\n\nMANUSCRIPT SAMPLE (for axiom extraction):\n---\n").concat(opts.manuscript.slice(0, 6000), "\n---\n\n## Instructions\n\nGenerate a comprehensive TechnicalAudit system prompt that:\n1. Lists all Chid Axioms and physical principles as stated in the manuscript.\n2. Defines LaTeX caption requirements for this document.\n3. Specifies the unit system and physical constants in use.\n4. Provides specific audit checklist items derived from the manuscript.\n\nReturn a JSON object with:\n- proposed_full_text: the complete new TechnicalAudit instructions \u2014 MUST be\n  valid GitHub-Flavored Markdown. Required sections (## H2 headings):\n    ## Chid Axioms\n    ## Physical Principles\n    ## LaTeX Requirements\n    ## Unit System & Constants\n    ## Audit Checklist\n  Use - bullet points, **bold** for axiom names and constants. No plain headings.\n- operations: one per major section being added or revised, each with a verbatim\n  match_text from proposed_full_text and a reason.\n").trim();
}
function buildAuditAnnotatePrompt(opts) {
    return "\nSTYLE PROFILE:\n---\n".concat(opts.styleProfile.slice(0, 2000), "\n---\n\nTECHNICAL AUDIT INSTRUCTIONS:\n---\n").concat(opts.auditInstructions.slice(0, 3000), "\n---\n\nPASSAGE TO AUDIT (from tab: \"").concat(opts.tabName, "\"):\n---\n").concat(opts.passage.slice(0, 8000), "\n---\n\n## Instructions\n\nPerform a full technical audit. Check every claim against the Chid Axiom,\nall equations for valid LaTeX captions, and all physical constants for\ncorrect SI values and units.\n\nReturn a JSON object with:\n- operations: one per issue found. Each must have:\n    - match_text: verbatim 3\u20134-word phrase from the passage above\n    - reason: specific axiom, constant, or caption rule violated, plus suggested correction\n").trim();
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
