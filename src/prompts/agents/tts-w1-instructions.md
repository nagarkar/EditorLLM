Generate an updated TTS instructions profile that does both of these jobs in one document:
1. Defines the global TTS policy for this project.
2. Defines a persistent cast / role registry that can be reused across tabs during TTS directive generation.

Use the StyleProfile as the primary source of truth for narration philosophy, sonic posture, and authorial tone.
Use the Manuscript Sample as secondary evidence only for:
- speaker topology
- dialogue/reporting patterns
- role classes present in the book
- edge cases such as quotations, citations, inner monologue, technical notation, or source excerpts

The generated instructions must:
1. Separate narrator, dialogue, quoted-source, inner-monologue, technical-reading, and fallback behavior.
2. Define a conservative transition policy: do not switch voices unless speaker identity is explicit or strongly implied.
3. Prefer too few voice changes over too many.
4. Preserve useful manual edits from current instructions when still compatible with the latest StyleProfile and Manuscript evidence.
5. Use the cached ElevenLabs voice registry above when assigning voice names and voice IDs.
6. Never invent a voice ID that does not appear in the cached ElevenLabs voice registry.
7. Write `NOT PROVIDED` in all caps for any missing vendor-specific field instead of omitting the field.

Compare "Current TTS Instructions (if any)" with "Last Generated Instructions" to identify potential author edits — differences likely reflect manual changes since the last generation. Preserve those edits unless clearly superseded by stronger StyleProfile or Manuscript evidence above. Note: some differences may reflect a prior generation run with different source material rather than a deliberate user edit.

Return the complete TTS instructions as plain GitHub-Flavored Markdown, starting directly with the first `##` heading. Do NOT wrap the response in JSON or any other format.
