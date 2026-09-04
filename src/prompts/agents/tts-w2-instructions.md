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
- If the Cast Role Policy marks `voice_id` or `tts_model` as `NOT PROVIDED`, do not guess a replacement value — leave the field's value as `NOT_PROVIDED` if the schema permits, otherwise omit the operation entirely.
- For `stability` and `similarity_boost` specifically, when the Cast Role Policy does not specify a concrete number, use the **project defaults**: `stability: 0.5`, `similarity_boost: 0.75`. **Never emit `0` for either field** — `0` is treated by the system as "model gave up" and silently overridden. If you genuinely have no policy guidance, the defaults above are correct.

Identify key transition points in the text where the active TTS voice or parameters should change (e.g. start of a new character's dialogue, shift in tone, return to narration). Also identify structural breaks (chapter transitions, scene breaks, significant dramatic pauses) where silence should be inserted between audio segments.

Return a JSON object with:
- operations: an array of objects. Two operation types are allowed:

**TTS operation** — marks a voice/parameter change:
    - match_text: a SHORT (3–8 word) verbatim string from a SINGLE paragraph that pinpoints where the voice/parameter change begins. **Do NOT include line breaks, paragraph breaks, or content from more than one paragraph.** Multi-paragraph match_text cannot be located in the document and the operation will be discarded. Pick a distinctive 3–8 word phrase from the first sentence of the new section.
    - tts_model: the alphanumeric model ID (e.g. "eleven_multilingual_v2")
    - voice_id: the alphanumeric voice ID
    - stability: a number between 0.0 and 1.0 representing voice stability — use the Cast Role Policy value, or **0.5** as the project default. **Never emit 0.**
    - similarity_boost: a number between 0.0 and 1.0 representing voice similarity boost — use the Cast Role Policy value, or **0.75** as the project default. **Never emit 0.**

**Break operation** — inserts silence that physically splits audio segments:
    - match_text: verbatim text of the break marker or immediately before the break point
    - duration_ms: silence duration in milliseconds (integer, e.g. 2000 for 2 seconds)
    - apply_to: (optional) "first_occurrence" (default) or "every_occurrence"
      Use "every_occurrence" when the match_text is a repeating structural marker
      such as `---` or `* * *` that should trigger a break at every instance in the tab.
      Use "first_occurrence" (or omit the field) for unique locations.

When to add breaks:
- Scene breaks marked by `* * *` or `---` dividers (typically 1000–2000 ms) — use apply_to: "every_occurrence" for these
- Significant dramatic pauses that benefit from true silence rather than punctuation-driven pacing

**Do NOT emit break operations for:**
- **Headings** (H1/H2/H3/H4/H5/H6 paragraph styles) — the system auto-injects breaks before and after every heading paragraph (H1=3.25s, H2=2.25s, H3+=1.25s; adjacent headings collapse to the smaller duration). Adding your own break for a heading creates a duplicate.
- **Ellipses** (`"..."` or `"…"`) — the system auto-injects 1s breaks at every ellipsis. Adding your own duplicates them.

Break placement rules (strictly enforced):
- Do NOT add a break before the first TTS directive — leading breaks are discarded.
- Do NOT add a break at the very end of the tab after all text — trailing breaks are discarded.
- Do NOT add two or more consecutive break operations with no TTS operation between them — consecutive breaks are collapsed to the one with the highest duration. Prefer one well-placed break over multiple redundant ones.
- A break operation does not change the active voice; the voice in effect before the break continues after it.
- When using apply_to: "every_occurrence", emit only one break operation for that marker — the system will expand it to all occurrences automatically. Do not emit a separate break operation per occurrence.
