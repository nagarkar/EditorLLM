"use strict";
// ============================================================
// Fixture tab content for integration tests.
//
// Represents a realistic manuscript document about the Chid Axiom.
// Intentional issues are planted for agents to find:
//   - Rhythmic: "persistent persistence of perception pervades" (EarTune)
//   - Technical: |⟨a_n|ψ⟩|³ should be |⟨a_n|ψ⟩|² (AuditAgent)
//   - Structural: thesis→observation→formalization pattern for Architect
// ============================================================
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ARCHITECT_THREADS = exports.NULL_ANCHOR_THREAD = exports.CHAPTER_1_THREADS = exports.INTEGRATION_SYSTEM_PROMPT = exports.FIXTURES = void 0;
exports.makeThreads = makeThreads;
exports.FIXTURES = {
    MERGED_CONTENT: "\nChapter 1: The Ground of Being\n\nThe Chid Axiom asserts that consciousness \u2014 pure awareness, the Sanskrit Chit \u2014 is the\nirreducible ground of all physical phenomena. This is not a metaphorical claim; it is a\nmathematical one.\n\nConsider the measurement problem in quantum mechanics. The wave function \u03C8 evolves\ndeterministically under the Schr\u00F6dinger equation: i\u210F \u2202\u03C8/\u2202t = \u0124\u03C8. At the moment of\nobservation, \u03C8 collapses to a definite eigenstate. Orthodox quantum mechanics offers no\nmechanism for this collapse. The Copenhagen interpretation defers to the observer\nwithout defining what an observer is.\n\nThe Chid Axiom fills this gap. The observer is not a macroscopic measuring device.\nThe observer is consciousness itself \u2014 the only entity that cannot be further reduced.\nWhen consciousness attends to a quantum system, the superposition collapses because\nconsciousness is the ground in which superposition exists.\n\nThe persistent persistence of perception pervades the particulars of all physical processes.\nIn that short declaration, everything. The probably possibly perhaps perpetual pattern of\nquantum probability produces peculiar phenomena that resist materialist reduction.\n".trim(),
    STYLE_PROFILE: "\n# StyleProfile\n\n## Voice & Tone\n- First-person philosophical inquiry; intimate yet authoritative.\n- Rhetorical questions invite the reader into the argument.\n- Declarative assertions follow extended phenomenological observations.\n\n## Sentence Rhythm\n- Alternates between long meditative sentences (20\u201335 words) and short declarative\n  sentences (5\u20138 words).\n- Paragraph-final sentences are always declarative and conclusive.\n- Avoids consonant clusters and tongue-twisters that impede spoken reading.\n\n## Vocabulary Register\n- Technical physics terms (eigenstate, superposition, Hilbert space) placed alongside\n  Sanskrit philosophical terms (Chit, Brahman, \u0100nanda).\n- Every technical term is glossed in prose on first use.\n\n## Structural Patterns\n- Chapters follow: Thesis \u2192 Phenomenological Observation \u2192 Mathematical Formalization\n  \u2192 Synthesis.\n- Footnotes contain only LaTeX equations and source citations.\n\n## Thematic Motifs\n- Consciousness as the only irreducible axiom.\n- The observer\u2013observed collapse as a mirror of Vedantic non-duality.\n".trim(),
    EAR_TUNE: "\n# EarTune Instructions\n\n1. Vary sentence length deliberately: after 3+ long sentences, use a short one.\n2. Avoid consonant clusters that create tongue-twisters when read aloud.\n3. Prefer stressed syllables at sentence ends for cadential closure.\n4. Alliteration is acceptable sparingly; never 3+ alliterative words in a row.\n5. Test every rewrite by reading the sentence aloud mentally before proposing it.\n6. Honour the manuscript's rhythm: intimate, measured, philosophically weightful.\n".trim(),
    TECHNICAL_AUDIT: "\n# TechnicalAudit Instructions\n\n## Chid Axiom Compliance\n- All consciousness claims must ground in Chit = pure awareness (not brain/neural).\n- Observer = consciousness itself, not any macroscopic measuring apparatus.\n\n## Physics Formulas (correct forms)\n- Schr\u00F6dinger equation: i\u210F \u2202\u03C8/\u2202t = \u0124\u03C8\n- Born rule: probability = |\u27E8\u03C6|\u03C8\u27E9|\u00B2   \u2190 exponent MUST be 2, not 3\n- Energy eigenvalue equation: \u0124\u03C8 = E\u03C8  \u2190 not iE\u03C8\n- Use \\hat{H} for Hamiltonian operator in LaTeX; never bare H\n\n## LaTeX Requirements\n- Every displayed equation must have a descriptive caption.\n- Use \\hbar for \u210F, \\psi for \u03C8 in LaTeX source.\n".trim(),
    COMMENT_INSTRUCTIONS: "\n# Comment Instructions\n\nRespond to @AI comment threads with:\n- Concise, voice-consistent replies (2\u20134 sentences maximum).\n- Grounding in the manuscript's Chid Axiom framework.\n- No introduction of external philosophical systems not present in the manuscript.\n- Always end with \"\u2014 AI Editorial Assistant\".\n".trim(),
    /** A working chapter tab with a planted technical error (exponent 3 instead of 2). */
    CHAPTER_1: "\nIn the beginning, the observer attends and the wave collapses inward upon itself\nwith inexorable mathematical precision. The eigenstate emerges, definite and irreversible.\nConsciousness did not cause this; consciousness is this.\n\nQuantum mechanics without an observer is like algebra without variables: formally\nconsistent but semantically empty. The Chid Axiom provides the missing variable.\nLet \u03A9 denote the intentional field of consciousness. The measurement of any observable A\nyields eigenvalue a_n with probability P = |\u27E8a_n|\u03C8\u27E9|\u00B3.\n\nNote the peculiar peculiar pattern: phenomena pile upon phenomena, producing a\nperpetually perplexing portrait of physical reality that defies materialist description.\n".trim(),
};
/** Minimal system prompt used across integration tests.
 *  Keeps tests stable against changes to the full Prompts.ts system prompts
 *  while still exercising the schema compliance path. */
exports.INTEGRATION_SYSTEM_PROMPT = 'You are an AI editorial assistant for a manuscript about the Chid Axiom ' +
    '(consciousness as the sole ground of physics). ' +
    'Respond concisely and return JSON that exactly matches the provided schema.';
// ── Multi-thread fixtures ─────────────────────────────────────────────────────
/**
 * Builds an array of TestThread objects for batch integration tests.
 * Each thread gets a unique threadId derived from the provided base and index.
 */
function makeThreads(base, count, idPrefix) {
    if (idPrefix === void 0) { idPrefix = 'thread'; }
    return Array.from({ length: count }, function (_, i) { return (__assign(__assign({}, base), { threadId: "".concat(idPrefix, "-").concat(String(i + 1).padStart(3, '0')), 
        // Slightly vary agentRequest so threads are meaningfully distinct
        agentRequest: count > 1
            ? "".concat(base.agentRequest, " (").concat(i + 1, "/").concat(count, ")")
            : base.agentRequest })); });
}
/** Two threads anchored to CHAPTER_1 — for anchor-tab subgrouping tests. */
exports.CHAPTER_1_THREADS = [
    {
        threadId: 'ch1-thread-001',
        selectedText: 'The eigenstate emerges, definite and irreversible.',
        agentRequest: 'Is this phrasing consistent with the Chid Axiom framework?',
        conversation: [
            { role: 'User', authorName: 'Author', content: '@AI Is this phrasing consistent?' },
        ],
    },
    {
        threadId: 'ch1-thread-002',
        selectedText: 'consciousness is this',
        agentRequest: 'Clarify the ontological claim here.',
        conversation: [
            { role: 'User', authorName: 'Author', content: '@AI Clarify the ontological claim.' },
        ],
    },
];
/** One thread with no anchor tab (null anchorTabName) — tests fallback behaviour. */
exports.NULL_ANCHOR_THREAD = {
    threadId: 'null-anchor-thread-001',
    selectedText: 'The Chid Axiom fills this gap.',
    agentRequest: 'Summarise the significance of this claim.',
    conversation: [
        { role: 'User', authorName: 'Author', content: '@AI Summarise this.' },
    ],
};
/** Two threads for ArchitectAgent (no anchor needed). */
exports.ARCHITECT_THREADS = [
    {
        threadId: 'arch-thread-001',
        selectedText: 'The Chid Axiom asserts that consciousness is the irreducible ground',
        agentRequest: 'Does this thesis statement match the structural pattern described in StyleProfile?',
        conversation: [
            { role: 'User', authorName: 'Author', content: '@architect Check structural pattern.' },
        ],
    },
    {
        threadId: 'arch-thread-002',
        selectedText: 'Orthodox quantum mechanics offers no mechanism for this collapse.',
        agentRequest: 'Is the transition from observation to formalization clear here?',
        conversation: [
            { role: 'User', authorName: 'Author', content: '@architect Is the transition clear?' },
        ],
    },
];
