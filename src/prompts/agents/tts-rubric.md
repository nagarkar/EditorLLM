## TTS instruction quality (score 0–5)

Judge whether the markdown is a **usable directive playbook** for the text-to-speech annotation agent: voice casting, prosody parameters, and per-passage override guidance.

### Dimensions to check

- **Required structure** — contains the required `##` sections, especially the exact heading `## Cast Role Policy (do not delete)`.
- **Voice assignments** — named roles (narrator, character dialogue, inner monologue, quoted text) are mapped to specific voice IDs or named voices with brief justification.
- **Parameter grounding** — `stability` and `similarity_boost` values are given as concrete ranges per role type, not vague adjectives. Ranges are narrow enough to be actionable (e.g. `0.55–0.65` for narration) rather than the full 0–1 span.
- **Model selection guidance** — the instructions specify which TTS model tier (e.g. `eleven_multilingual_v2`, `eleven_turbo_v2`) maps to which content class (narration vs. short quotes vs. long philosophical passages).
- **Edge-case handling** — covers at least two special cases: emphasis / italicised text, multi-paragraph runs, mathematical or technical notation that should be read aloud naturally, or language-switching passages.
- **W2 operational clarity** — another annotator could apply these instructions without ambiguity: each rule names a concrete `match_text` pattern or content category, not a vague intention.

### Scoring guide

| Score | Criteria |
|:-----:|----------|
| **5** | All dimensions present; required heading exists; cast-role table is operational; parameter ranges are manuscript-specific and grounded; W2 guidance is self-contained. |
| **4** | Strong overall; one dimension (usually edge-cases or model selection) thin but not absent. |
| **3** | Voice assignments and stability ranges present; edge-case or model guidance is shallow. |
| **2** | Generic "use a warm voice for narration" prose; no concrete parameter values, or missing cast-role table detail. |
| **1** | Outline or placeholder only; not operational. |
| **0** | Empty, incoherent, or evaluation error. |
