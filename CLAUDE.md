# EditorLLM — Claude Instructions

## Project Scope
- Place rule files, config, and project-specific assets at the PROJECT level (e.g., `.claude/` inside the project), not at the workspace/global level unless explicitly requested.

## Testing
- After any code change, run the full test suite (unit + parity) and lint before reporting completion. Include passing test counts in the summary.
- When modifying service/API-key handling, also update test fixtures and mocks (e.g., getUserProperties) to match.

## Error Handling Philosophy
- Prefer clear error detection and logging over silent repair/recovery logic. Do not add JSON-repair, retry-with-mutation, or auto-correction layers unless explicitly requested.

## Implementation Completeness
- When adding a feature to one code path (e.g., directive generation), check for and apply it to all parallel paths (e.g., plain Generate Audio, HQ) before declaring complete.
- Before implementing any change, explicitly enumerate every parallel code path the change must touch. Implement across all of them in a single pass. Confirm parity in the completion summary — list each path and whether it was updated.
