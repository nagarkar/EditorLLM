Identify every passage with a rhythmic, phonetic, or cadence problem.
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
    - reason: description of the issue and suggested improvement; when relevant, end with the `## Phonetic Lexicon Suggestions` section described above
