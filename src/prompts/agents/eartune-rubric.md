## Ear-Tune instruction quality (score 0–5)

Judge whether the markdown is a **usable Ear-Tune system prompt**: rules an annotator can apply for **spoken clarity, stress, and cadence** while respecting the StyleProfile.

### What "good" looks like
- **`##` sections** for major concerns (e.g. stress & closure, consonant clusters, sentence length ebb/flow, dialogue vs exposition).
- **Actionable bullets** — each rule ties to *how* to edit, not vague advice ("vary rhythm" → *how* to detect and fix).
- **Grounding** — references sonic goals that plausibly follow from a StyleProfile (even if the manuscript sample was omitted in W1).
- **W2 alignment** — instructions should support finding `match_text` spans and short `reason` strings.

### Scoring guide

| Score | Criteria |
|:-----:|----------|
| **5** | ≥ 3 strong `##` areas; concrete phonetic/cadence guidance; minimal fluff. |
| **4** | Solid structure; one thin section or slightly generic phrasing. |
| **3** | At least two substantive `##` themes; usable for sweeps with care. |
| **2** | Mostly boilerplate, or missing clear `##` structure. |
| **1** | Barely actionable list of platitudes. |
| **0** | Empty, wrong artifact, or evaluation error. |
