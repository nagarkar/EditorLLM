// ============================================================
// Fixture tab content for integration tests.
//
// Represents a realistic manuscript document about the Chid Axiom.
// Intentional issues are planted for agents to find:
//   - Rhythmic: "persistent persistence of perception pervades" (EarTune)
//   - Technical: |⟨a_n|ψ⟩|³ should be |⟨a_n|ψ⟩|² (AuditAgent)
//   - Structural: thesis→observation→formalization pattern for Architect
// ============================================================

export const FIXTURES = {

  MERGED_CONTENT: `
Chapter 1: The Ground of Being

The Chid Axiom asserts that consciousness — pure awareness, the Sanskrit Chit — is the
irreducible ground of all physical phenomena. This is not a metaphorical claim; it is a
mathematical one.

Consider the measurement problem in quantum mechanics. The wave function ψ evolves
deterministically under the Schrödinger equation: iℏ ∂ψ/∂t = Ĥψ. At the moment of
observation, ψ collapses to a definite eigenstate. Orthodox quantum mechanics offers no
mechanism for this collapse. The Copenhagen interpretation defers to the observer
without defining what an observer is.

The Chid Axiom fills this gap. The observer is not a macroscopic measuring device.
The observer is consciousness itself — the only entity that cannot be further reduced.
When consciousness attends to a quantum system, the superposition collapses because
consciousness is the ground in which superposition exists.

The persistent persistence of perception pervades the particulars of all physical processes.
In that short declaration, everything. The probably possibly perhaps perpetual pattern of
quantum probability produces peculiar phenomena that resist materialist reduction.
`.trim(),

  STYLE_PROFILE: `
# StyleProfile

## Voice & Tone
- First-person philosophical inquiry; intimate yet authoritative.
- Rhetorical questions invite the reader into the argument.
- Declarative assertions follow extended phenomenological observations.

## Sentence Rhythm
- Alternates between long meditative sentences (20–35 words) and short declarative
  sentences (5–8 words).
- Paragraph-final sentences are always declarative and conclusive.
- Avoids consonant clusters and tongue-twisters that impede spoken reading.

## Vocabulary Register
- Technical physics terms (eigenstate, superposition, Hilbert space) placed alongside
  Sanskrit philosophical terms (Chit, Brahman, Ānanda).
- Every technical term is glossed in prose on first use.

## Structural Patterns
- Chapters follow: Thesis → Phenomenological Observation → Mathematical Formalization
  → Synthesis.
- Footnotes contain only LaTeX equations and source citations.

## Thematic Motifs
- Consciousness as the only irreducible axiom.
- The observer–observed collapse as a mirror of Vedantic non-duality.
`.trim(),

  EAR_TUNE: `
# EarTune Instructions

1. Vary sentence length deliberately: after 3+ long sentences, use a short one.
2. Avoid consonant clusters that create tongue-twisters when read aloud.
3. Prefer stressed syllables at sentence ends for cadential closure.
4. Alliteration is acceptable sparingly; never 3+ alliterative words in a row.
5. Test every rewrite by reading the sentence aloud mentally before proposing it.
6. Honour the manuscript's rhythm: intimate, measured, philosophically weightful.
`.trim(),

  TECHNICAL_AUDIT: `
# TechnicalAudit Instructions

## Chid Axiom Compliance
- All consciousness claims must ground in Chit = pure awareness (not brain/neural).
- Observer = consciousness itself, not any macroscopic measuring apparatus.

## Physics Formulas (correct forms)
- Schrödinger equation: iℏ ∂ψ/∂t = Ĥψ
- Born rule: probability = |⟨φ|ψ⟩|²   ← exponent MUST be 2, not 3
- Energy eigenvalue equation: Ĥψ = Eψ  ← not iEψ
- Use \\hat{H} for Hamiltonian operator in LaTeX; never bare H

## LaTeX Requirements
- Every displayed equation must have a descriptive caption.
- Use \\hbar for ℏ, \\psi for ψ in LaTeX source.
`.trim(),

  COMMENT_INSTRUCTIONS: `
# Comment Instructions

Respond to @AI comment threads with:
- Concise, voice-consistent replies (2–4 sentences maximum).
- Grounding in the manuscript's Chid Axiom framework.
- No introduction of external philosophical systems not present in the manuscript.
- Always end with "— AI Editorial Assistant".
`.trim(),

  /** A working chapter tab with a planted technical error (exponent 3 instead of 2). */
  CHAPTER_1: `
In the beginning, the observer attends and the wave collapses inward upon itself
with inexorable mathematical precision. The eigenstate emerges, definite and irreversible.
Consciousness did not cause this; consciousness is this.

Quantum mechanics without an observer is like algebra without variables: formally
consistent but semantically empty. The Chid Axiom provides the missing variable.
Let Ω denote the intentional field of consciousness. The measurement of any observable A
yields eigenvalue a_n with probability P = |⟨a_n|ψ⟩|³.

Note the peculiar peculiar pattern: phenomena pile upon phenomena, producing a
perpetually perplexing portrait of physical reality that defies materialist description.
`.trim(),

} as const;

/** Minimal system prompt used across integration tests.
 *  Keeps tests stable against changes to the full Prompts.ts system prompts
 *  while still exercising the schema compliance path. */
export const INTEGRATION_SYSTEM_PROMPT =
  'You are an AI editorial assistant for a manuscript about the Chid Axiom ' +
  '(consciousness as the sole ground of physics). ' +
  'Respond concisely and return JSON that exactly matches the provided schema.';
