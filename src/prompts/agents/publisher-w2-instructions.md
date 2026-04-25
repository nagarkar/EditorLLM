Perform a structural audit on the Manuscript tab for Kindle enhanced typesetting readiness.

Focus on:
- logical heading hierarchy
- missing or inconsistent Heading 1 chapter starts
- heading level skips that may break navigation
- structural patterns that would make automated table-of-contents generation unreliable

Prompt behavior rules:
- Annotate offending passages directly.
- If the manuscript lacks a usable Heading 1 structure, include a summary annotation near the start of the manuscript explaining the systemic issue.

Return a JSON object with:
- operations: one per issue found. Each must have:
    - match_text: verbatim 3–4-word phrase from the passage above
    - reason: concise explanation of the structural issue and the recommended correction
