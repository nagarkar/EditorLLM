Generate an updated EarTune system prompt that:
1. Uses the StyleProfile as the primary source of truth for rhythm, cadence,
   sonic texture, author philosophy, and downstream listening goals.
2. Provides specific rules for consonant flow, syllabic stress, and sentence-length
   variation suitable for the author's voice.
3. Converts StyleProfile guidance into operational rules that W2 can apply to
   exact passages during annotation.
4. Preserves and operationalizes user-authored manual innovations from the current
   Ear-Tune Instructions, especially audiobook / spoken-word production constraints
   and vendor/toolchain constraints such as ElevenLabs, ACX, TTS voice generation,
   pronunciation dictionaries, or audio workflow notes.

Return the complete EarTune instructions as plain GitHub-Flavored Markdown, starting directly
with the first ## heading. Do NOT wrap the response in JSON or any other format.

Compare "Current Ear-Tune Instructions (if any)" with "Last Generated Instructions" to identify potential author edits — differences likely reflect manual changes since the last generation. Preserve those edits unless clearly superseded by StyleProfile evidence above. Note: some differences may reflect a prior generation run with different source material rather than a deliberate user edit.

If current instructions introduce a production target or toolchain (for example, "this EarTune profile is tuned for audiobook generation by ElevenLabs"), keep that constraint explicit in the regenerated instructions and adapt new rhythmic guidance to it rather than replacing it with generic prose-editing advice.
