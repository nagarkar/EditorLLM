Perform an external source validation sweep.
1. Flag invalid references or factual errors.
2. Identify "controversial" statements and annotate them with context.
3. Suggest 2–3 specific "missed opportunities" for alignment with prior
   historical or scientific work.

Return a JSON object with:
- operations: one per issue or opportunity found. Each must have:
    - match_text: verbatim 3–4-word phrase from the passage above
    - reason: description of the factual discrepancy or alignment opportunity
