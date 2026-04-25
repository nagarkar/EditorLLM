Use the `## Cast Role Policy (do not delete)` section inside TTS Instructions as the primary source of truth for cast assignment, voice IDs, model IDs, and default parameters.
Use the rest of TTS Instructions as the secondary source of truth for transition policy, ambiguity handling, and edge cases.
Use the StyleProfile only as tertiary context when applying the existing cast-role policy to the current passage.

When creating directives:
- Reuse an existing cast from the Cast Role Policy whenever possible.
- Do not invent a new voice or role if an existing narrator / fallback / dialogue class already fits.
- If speaker identity is ambiguous, keep narrator voice or the documented fallback cast.
- Quotation marks alone do not justify a voice switch.
- Only place directives at meaningful transition points where the active cast or parameters should change.
- Use the exact `voice_id`, `tts_model`, `stability`, and `similarity_boost` values from the Cast Role Policy whenever that policy provides them.
- If the Cast Role Policy marks a required field as `NOT PROVIDED`, do not guess a replacement value.

Identify key transition points in the text where the active TTS voice or parameters should change (e.g. start of a new character's dialogue, shift in tone, return to narration).
Return a JSON object with:
- operations: an array of objects. Each must have:
    - match_text: verbatim text where the change should occur
    - tts_model: the alphanumeric model ID (e.g. "eleven_multilingual_v2")
    - voice_id: the alphanumeric voice ID
    - stability: a number between 0.0 and 1.0 representing voice stability
