Identify every passage with a rhythmic, phonetic, or cadence problem.
Only annotate when you can name a real issue and provide a concrete fix that is
different from the current wording or punctuation.

Reason format requirements:
- Start with a brief diagnosis.
- Then include `Suggested rewrite: "..."` with the exact replacement wording or punctuation pattern you want.
- The suggested rewrite may be a clause or full sentence, but it must NOT be copied verbatim from the passage.
- If you cannot supply a distinct rewrite, omit the annotation entirely.

Also scout for "Pronunciation Traps" in the passage:
- Scan for proper nouns (character/place names), technical jargon, or uncommon words (e.g., "Chid", "Axiom", "Eigenstate").
- For any annotation involving a pronunciation trap, append to the end of that operation's `reason` a markdown section headed `## Phonetic Lexicon Suggestions`.
- Under that heading, include one entry per trap in this format:
  - Word: [Exact Spelling]
  - Phonetic: [IPA or simple phonetic, e.g., CHID AK-see-um]
  - Context: [Short phrase using the word]

Return a JSON object with:
- operations: one per problem found. Each must have:
    - match_text: verbatim 3–4-word phrase from the passage above
    - reason: brief diagnosis plus `Suggested rewrite: "..."`; when relevant, end with the `## Phonetic Lexicon Suggestions` section described above
