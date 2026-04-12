# Structural Architect

## What It Does

The Structural Architect analyses your manuscript and produces a **StyleProfile** — a comprehensive description of the author's voice, sentence rhythm, vocabulary register, structural patterns, and thematic motifs. This StyleProfile constrains all other agents, ensuring every edit stays consistent with the author's established style.

## Sidebar Actions

### Generate Example

Click **Generate Example** to populate the MergedContent and StyleProfile tabs with sample content. This shows you the expected shape of each tab before you use your own manuscript.

Use this when you're setting up EditorLLM for the first time and want to see what the output looks like.

### Generate (StyleProfile)

Click **Generate** to run the full StyleProfile generation:

1. The Architect reads the **MergedContent** tab (up to 20,000 characters).
2. It sends the text to Gemini (thinking tier) with instructions to analyse voice, rhythm, vocabulary, structure, and motifs.
3. The result is written to a **StyleProfile Scratch** review tab.
4. Each style dimension is highlighted and annotated with comments explaining the reasoning.

**After generation:** Review the StyleProfile Scratch tab. If you approve, copy its content to the StyleProfile tab. If not, edit or regenerate.

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

| Tab | Why |
|---|---|
| MergedContent | The source manuscript to analyse |

## Model Tier

Uses **Thinking** (extended reasoning) — deep style analysis requires careful multi-step reasoning about patterns across the full manuscript.
