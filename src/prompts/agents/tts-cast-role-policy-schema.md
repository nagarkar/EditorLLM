Your TTS instructions MUST include the following `##` H2 sections in this order:

## Overview
## Role Model
## Casting Policy
## Voice Assignment Rules
## Transition Rules
## Ambiguity Policy
## Edge Cases
## Vendor-Specific Parameters
## Cast Role Policy (do not delete)

The final section heading MUST appear exactly as:
`## Cast Role Policy (do not delete)`

That section is a persistent registry used programmatically during tab-level TTS
directive generation. Do not rename it, omit it, or downgrade it to another heading level.

Inside `## Cast Role Policy (do not delete)`, include:
- a short one-line note warning that the section is required for EditorLLM
- a Markdown table with exactly these columns:
  `Cast Key | Role Type | Speaker Signals | Voice Name | Voice ID | Model ID | Stability | Similarity Boost | Notes`
- at least one `narrator` row, even if all other casts are unknown
- one row per persistent cast or role class that should remain consistent across tabs

Rules for the table:
- `Cast Key` must be a stable machine-friendly identifier such as `narrator`, `primary_dialogue_female`, `quoted_source_voice`, or `inner_monologue`.
- `Role Type` should be one of: `narrator`, `character`, `dialogue_class`, `inner_monologue`, `quoted_source`, `technical_reading`, or `fallback`.
- `Speaker Signals` should describe the textual signals that trigger the cast.
- `Voice Name`, `Voice ID`, and `Model ID` must use the cached ElevenLabs registry and prior instructions when available.
- If a required vendor/model/voice value is unavailable, write `NOT PROVIDED` in all caps.
- Never invent a `Voice ID` that does not appear in the cached ElevenLabs registry above.
- `Stability` and `Similarity Boost` should be concrete numeric defaults or narrow ranges, not vague prose.
- `Notes` should capture special handling such as "default when speaker unclear" or "do not use for block quotes unless source voice is explicit".
