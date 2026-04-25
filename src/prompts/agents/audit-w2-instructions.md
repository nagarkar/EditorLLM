Perform a full technical audit. Check every factual claim against the
manuscript's established framework and core axioms, all technical notations
for correctness, and verify terminology is consistent with established definitions.

Return a JSON object with:
- operations: one per issue found. Each must have:
    - match_text: verbatim 3–4-word phrase from the passage above
    - reason: specific principle, definition, or notation violated, plus suggested correction
