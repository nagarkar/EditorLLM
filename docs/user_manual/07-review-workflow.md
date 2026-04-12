# Review Workflow: Scratch Tabs & Annotations

## How EditorLLM Applies Changes

EditorLLM never silently overwrites your manuscript. Every change goes through a structured review process depending on the workflow type.

## Instruction Updates (Scratch Tabs)

When an agent generates or regenerates its system prompt (StyleProfile, EarTune, TechnicalAudit, or Comment Instructions), the result is written to a **Scratch** tab — not the live tab.

### Flow

1. You click **Generate** in the sidebar.
2. The agent calls Gemini and receives a proposed instruction set.
3. A "Scratch" tab is created (e.g., **StyleProfile Scratch**).
4. The proposed content is written to the Scratch tab.
5. Key sections are highlighted in yellow and annotated with comments explaining the reasoning.

### What to Do Next

- **Review** the Scratch tab. Read the proposed instructions.
- **Accept**: Copy the content from the Scratch tab to the live tab (e.g., StyleProfile).
- **Edit**: Modify the Scratch tab content before copying.
- **Reject**: Delete the Scratch tab. The live tab is unchanged.

> The Scratch tab is overwritten each time you regenerate. There's no history — if you want to keep a version, copy it to a separate tab first.

## Content Updates (Direct Edits with Annotations)

When an agent edits your prose (Ear-Tune, Technical Audit, or comment-triggered rewrites), changes are applied directly to the target tab.

### Flow

1. You trigger an action (Ear-Tune, Audit, or process a comment).
2. The agent calls Gemini and receives a list of operations (match_text → new_text).
3. For each operation:
   - The matched passage is found in the target tab.
   - The text is replaced with the new version via the Docs API.
   - The passage is highlighted in yellow and bolded.
   - A Drive comment is added with the reasoning for the change.

### What to Do Next

- **Review** the highlighted passages in your document.
- **Accept**: Resolve the comment (click the checkmark) and remove the highlight.
- **Reject**: Use Ctrl+Z / Cmd+Z to undo, or manually revert the text. Resolve the comment.
- **Discuss**: Reply to the comment with `@AI` to ask the agent to explain or revise.

## Understanding the Annotations

| Visual Cue | Meaning |
|---|---|
| Yellow highlight + bold | A passage that was changed by an agent |
| Drive comment | The agent's reasoning for the change |
| "— AI Editorial Assistant" | Sign-off on a comment reply |

## Tips

- **Always review before moving on.** Agents make mistakes — they may misidentify a match or propose an unsuitable rewrite.
- **Use the comments as a conversation.** If a change is wrong, reply with `@AI Why did you change this?` and reprocess.
- **Scratch tabs accumulate.** Periodically clean up old Scratch tabs you no longer need.
