# Structural Architect

## What It Does

The Structural Architect analyses your manuscript and produces a **StyleProfile** — a comprehensive description of the author's voice, sentence rhythm, vocabulary register, structural patterns, and thematic motifs. This StyleProfile constrains all other agents, ensuring every edit stays consistent with the author's established style.

## Sidebar Actions

### Workflow 1: Instructions (StyleProfile)
1.  **Generate:** Click **Generate** in the Sidebar. The Architect reads `MergedContent` (your manuscript) and your **existing** `StyleProfile` (if any) to synthesise a comprehensive set of rules.
2.  **Review:** Open the `StyleProfile` tab to review the proposed rules.
3.  **Refine:** Edit the markdown in `StyleProfile` directly. The next time you click **Generate**, your manual changes will be incorporated (recursive feedback).
4.  **Backup:** Each generation moves the previous rules to `StyleProfile Scratch`.

## Comment Routing: `@architect`

You can also invoke the Architect from a comment thread:

1. Select a passage in your document.
2. Add a comment starting with `@architect` followed by your question or instruction:
   ```
   @architect Does this passage contradict the established motif from Chapter 1?
   ```
3. Click **Process @AI Comments** in the sidebar (or run it from the menu).

The Architect will:
- Analyse the selected passage in the context of the full MergedContent.
- Decide whether the issue requires a **content fix** (rewriting the passage) or a **StyleProfile update** (codifying a new pattern).
- Apply the changes via the collaboration system.
- Post a reply summarising what was done.

## When to Run

- **After merging tabs** — whenever MergedContent changes, regenerate the StyleProfile so other agents use current data.
- **After significant edits** — if you've rewritten major sections, the style characteristics may have shifted.
- **On demand via comments** — for targeted architectural questions about specific passages.

## What It Reads

| Workflow | Tab | Format | Why |
|---|---|---|---|
| **Generate (W1)** | MergedContent | Plain Text | Analyzes the full manuscript to derive a StyleProfile |
| **Comments (W3)** | MergedContent | Plain Text | High-level manuscript context for structural questions |
| **Comments (W3)** | StyleProfile | Plain Text | Voice and thematic constraints |

## Model Tier

Uses **Thinking** (extended reasoning) — deep style analysis requires careful multi-step reasoning about patterns across the full manuscript.
