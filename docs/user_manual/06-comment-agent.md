# Comment Agent (@AI Responder)

## What It Does

The Comment Agent is the default responder for `@AI` comment threads. It answers questions, acts on requests, and participates in editorial conversations — all in the author's voice as defined by the StyleProfile.

Unlike the other agents, the Comment Agent does **not** modify the document. It only posts replies.

## How to Use

### Writing an @AI Comment

1. Select a passage in your document (optional but recommended — it gives the AI context about what you're asking).
2. Click the comment icon (or press Ctrl+Alt+M / Cmd+Option+M).
3. Write your comment starting with `@AI`:
   ```
   @AI Is this passage consistent with the Chid Axiom?
   ```
4. Post the comment.

### Processing Comments

Click **Process @AI Comments** in the sidebar (green button in the Comment Agent section) or use the menu: **EditorLLM** > **Process @AI Comments**.

The system scans all comment threads and:
- Finds threads where the **last message** starts with a recognised `@tag`.
- Routes `@AI` threads to the Comment Agent.
- Routes `@architect`, `@eartune`, `@ear-tune`, `@audit`, `@auditor` to their respective agents.
- Posts a reply to each processed thread.
- Shows a summary: "Replied: 3, Skipped: 1".

### Multi-Turn Conversations

You can continue a conversation:

1. First comment: `@AI What does "eigenstate" mean in this context?`
2. AI replies.
3. You reply: `@AI Can you rephrase that more simply?`
4. Run Process @AI Comments again — the AI sees the full conversation history.

The AI only responds when the **last message** in the thread starts with `@AI`. If the last message is from the AI, the thread is skipped (already answered).

## Sidebar Actions

### Generate Example

Click **Generate Example** to write sample Comment Instructions to the Comment Instructions tab. This shows the expected format.

### Generate (Comment Instructions)

Click **Generate** to regenerate the Comment Instructions system prompt:

1. The agent reads the current StyleProfile to understand the manuscript's voice.
2. It produces a tailored set of instructions for how the AI should respond to comments.
3. The result is written to a **Comment Instructions Scratch** review tab.

Edit these instructions to fine-tune the AI's reply style, scope, and tone.

## What Gets Used as Context

When the Comment Agent processes a thread, it uses:

| Context | Source |
|---|---|
| System prompt | Comment Instructions tab (falls back to built-in default) |
| Selected text | The passage the comment is anchored to |
| Conversation history | All messages in the thread (user and AI turns) |
| Agent request | The text after `@AI` in the last message |

## Comment Tags — Full Reference

| Tag | Agent | Action |
|---|---|---|
| `@AI` | Comment Agent | Free-form reply (no doc changes) |
| `@architect` | Structural Architect | Architectural analysis or StyleProfile update |
| `@eartune` | Audio EarTune | Rhythmic rewrite of selected passage |
| `@ear-tune` | Audio EarTune | Hyphenated alias for `@eartune` |
| `@audit` | Logical Auditor | Technical audit of selected passage |
| `@auditor` | Logical Auditor | Same as `@audit` |

All tags are case-insensitive: `@AI`, `@ai`, `@Ai` all work.

## Tips

- **Be specific.** "@AI Clarify the use of 'superposition' in line 3" is better than "@AI Fix this."
- **Select the relevant text** before commenting — this gives every agent richer context.
- **Check the status bar** after processing. It shows how many threads were replied to and how many were skipped.
- **Review AI replies** — they are posted as regular Drive comments. You can delete or resolve them like any other comment.

## Model Tier

Uses **Fast** — comment responses should be quick and conversational.
