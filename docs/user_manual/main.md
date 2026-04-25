# EditorLLM User Manual

EditorLLM is an AI-augmented editing workspace for Google Docs. It provides a team of specialised AI agents that analyse, audit, and refine your manuscript while preserving your authorial voice.

---

## Table of Contents

1. [Setup & Configuration](01-setup.md)
2. [Tab Merger](02-tab-merger.md)
3. [Structural Architect](03-structural-architect.md)
4. [Audio EarTune (Ear-Tune)](04-audio-eartune.md)
5. [Logical Auditor (Technical Audit)](05-logical-auditor.md)
6. [Comment Agent (@AI Responder)](06-comment-agent.md)
7. [Review Workflow: Scratch Tabs & Annotations](07-review-workflow.md)
9. [External Anchor (Tether Agent)](09-tether-agent.md)
10. [Troubleshooting](08-troubleshooting.md)

---

# Setup & Configuration

## Opening EditorLLM

1. Open your Google Doc.
2. In the menu bar, click **EditorLLM** > **Open Sidebar**.
3. The sidebar appears on the right side of the document.

If you don't see the EditorLLM menu, the add-on may not be installed on this document. Ask the document owner to verify the script is bound and authorized.

### Live Log Sidebar

For long-running operations (Ear-Tune, Audit), a real-time progress log is available:

1. Click **EditorLLM** > **Open Log Sidebar**.
2. The log sidebar opens on the right. It polls every two seconds and streams log entries as the agent runs.
3. Each entry shows a timestamp, log level, and message — e.g., `[INFO] EarTuneAgent: processing paragraph 3/12`.

The log sidebar is non-blocking: you can continue reading or editing while an agent runs. Close it at any time; it does not interrupt the running operation.

## First-Time Setup

### Initialize Tabs

Click **Initialize Tabs** in the Setup section of the sidebar. This creates the standard tab structure your document needs:

| Tab | Location | Purpose |
|---|---|---|
| Manuscript | Root | Holds the combined manuscript text |
| Agentic Instructions | Root | Parent tab for all agent configuration |
| StyleProfile | Under Agentic Instructions | The generated style guide |
| EarTune | Under Agentic Instructions | Ear-Tune system prompt |
| TechnicalAudit | Under Agentic Instructions | Audit rules |
| TetherInstructions | Under Agentic Instructions | External fact-checking and alignment rules |
| Comment Instructions | Under Agentic Instructions | Instructions for the @AI comment responder |

You only need to do this once per document. Re-running it is safe — existing tabs are not overwritten.

## Agent Instruction Generation (W1)

Every agent can regenerate its own "system prompt" or instruction tab (e.g., the Structural Architect produces the `StyleProfile`). When you click **Generate** in an agent's sidebar section, the agent reads specific tabs as context to inform the new instructions.

| Agent | Tab Context Used for Generation | Format Read |
|---|---|---|
| **Structural Architect** | `Manuscript`, `StyleProfile` | Plain Text / **Markdown** |
| **Audio EarTune** | `StyleProfile`, `EarTune` | **Markdown** |
| **Logical Auditor** | `StyleProfile`, `TechnicalAudit`, `Manuscript` (First 6,000 chars) | **Markdown** / Plain |
| **Comment Agent** | `StyleProfile`, `Comment Instructions` | **Markdown** |
| **External Anchor** | `StyleProfile`, `TetherInstructions`, `Manuscript` (First 6,000 chars) | **Markdown** / Plain |

### Recursive Instruction Loop

EditorLLM implements a **recursive feedback loop**. When you generate new instructions:
1. The agent reads your **existing instructions** (if any) and incorporates them into its reasoning.
2. The **old instructions** are backed up to a corresponding **Scratch** tab (e.g., `StyleProfile Scratch`).
3. The **newly generated instructions** are written directly to the root instruction tab (e.g., `StyleProfile`).

This ensures that any manual refinements you make to the instructions are preserved and refined in the next iteration, rather than being "forgotten".

> **Note:** Reading tabs as **Markdown** allows the agent to see the exact structure (headings, bolding, bullet points) of your existing instructions, leading to more consistent regenerations.

### Set Your Gemini API Key

1. Click **Set API Key** in the Setup section.
2. A browser prompt asks for your Gemini API key.
3. Paste the key and click OK.

The key is stored in your personal user properties. If an administrator has set a shared key via script properties, that key takes precedence and you can skip this step.

To get a Gemini API key, visit [Google AI Studio](https://aistudio.google.com/apikey).

### ElevenLabs Document Warning

> **WARNING:** If you set an ElevenLabs API key for this document, anyone with access to the document can use ElevenLabs-related features from this add-on for that document. They cannot see the raw API key, but they can use the configured capability. Only enable ElevenLabs on documents you share with people you trust.

## Model Configuration

EditorLLM uses three model tiers. Each can be configured independently.

| Tier | Used by | Recommended for |
|---|---|---|
| **Fast** | Comment Agent, Audio EarTune | Low-latency tasks: comments, prose styling |
| **Thinking** | Structural Architect, Logical Auditor | Deep reasoning: style analysis, technical audits |
| **DeepSeek** | (Available for future agents) | Experimental model slot |

### Configuring Models

1. In the **Model Configuration** section of the sidebar, click **Refresh List** to fetch all available Gemini models from the API.
2. Type in each field — the dropdown autocompletes from the fetched list.
3. Click **Save** to persist your selection.

Click **Load Saved** at any time to see the currently configured models.

Default models are used when no configuration has been saved:
- Fast: `gemini-2.0-flash`
- Thinking: `gemini-2.5-pro-preview-03-25`
- DeepSeek: `gemini-2.0-flash-thinking-exp-01-21`

> **Tip:** If you see a "model not found" error when running an agent, the configured model may have been deprecated. Open the sidebar, click Refresh List, select an available model, and Save.

---

# Tab Merger

## What It Does

The Tab Merger combines content from multiple document tabs into a single **Manuscript** tab. This is the foundation for all agent work — agents read Manuscript as the canonical source of the manuscript.

## When to Use

- After writing or editing chapter tabs, merge them so agents see the latest text.
- Before generating a StyleProfile (the Architect reads Manuscript).
- Before running a technical audit across the full manuscript.

## How to Use

### From the Sidebar

1. Open the sidebar (**EditorLLM** > **Open Sidebar**).
2. Scroll to the **Create Manuscript** section.
3. In the text area, enter the tab names you want to merge, separated by commas:
   ```
   Chapter 1, Chapter 2, Chapter 3, Appendix A
   ```
4. Click **Save** to remember this list for next time.
5. Click **Create Manuscript**.

The merger:
1. Clears the Manuscript tab completely.
2. Copies the content of each listed tab into Manuscript, in the order you specified.
3. Inserts a page break between each tab's content.
4. Shows a progress indicator (e.g., "Merging 2 / 5: Chapter 2").

### Loading Saved Tab Names

Click **Load Saved** to restore the last-saved comma-separated list. This is useful when you merge the same set of tabs regularly.

## Important Notes

- **Tab names are case-sensitive.** "Chapter 1" and "chapter 1" are different.
- **Ordering matters.** Tabs are merged in the exact order you list them.
- **Manuscript is overwritten** every time you merge. The previous content is lost.
- If a listed tab doesn't exist, that tab is skipped and reported as an error in the status. Other tabs still merge successfully.
- The merge preserves formatting: paragraphs, tables, and list items are copied with their original styling.

## Typical Workflow

1. Write/edit your chapter tabs.
2. Open the sidebar, enter tab names, click **Create Manuscript**.
3. Run the Structural Architect to regenerate the StyleProfile from the fresh Manuscript.
4. Run Ear-Tune or Technical Audit on specific tabs.

---

# Structural Architect

## What It Does

The Structural Architect analyses your manuscript and produces a **StyleProfile** — a comprehensive description of the author's voice, sentence rhythm, vocabulary register, structural patterns, and thematic motifs. This StyleProfile constrains all other agents, ensuring every edit stays consistent with the author's established style.

## Sidebar Actions

### Generate (StyleProfile)

Click **Generate** to run the full StyleProfile generation:

1. The Architect reads the **Manuscript** tab (up to 20,000 characters).
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
- Analyse the selected passage in the context of the full Manuscript.
- Decide whether the issue requires a **content fix** (rewriting the passage) or a **StyleProfile update** (codifying a new pattern).
- Apply the changes via the collaboration system.
- Post a reply summarising what was done.

## When to Run

- **After merging tabs** — whenever Manuscript changes, regenerate the StyleProfile so other agents use current data.
- **After significant edits** — if you've rewritten major sections, the style characteristics may have shifted.
- **On demand via comments** — for targeted architectural questions about specific passages.

## What It Reads

| Tab | Why |
|---|---|
| Manuscript | The source manuscript to analyse |

## Model Tier

Uses **Thinking** (extended reasoning) — deep style analysis requires careful multi-step reasoning about patterns across the full manuscript.

---

# Audio EarTune (Ear-Tune)

## What It Does

The Audio EarTune optimises prose for spoken-word clarity and rhythmic listenability. It proposes rewrites that:

- Eliminate tongue-twisting consonant clusters.
- Ensure sentences land on stressed syllables.
- Vary sentence length to create an ebb-and-flow rhythm.
- Preserve meaning — only the sonic texture changes.

All edits are constrained by the StyleProfile, so the author's voice is maintained.

## Sidebar Actions

### Ear-Tune (Active Tab)

This is the primary editing action:

1. Navigate to the tab you want to optimise (e.g., a chapter tab).
2. Open the sidebar and find the **Audio EarTune** section.
3. The sidebar shows "Active tab: Chapter 1" (or whichever tab you're on). Click the **↻** button to refresh if it shows the wrong tab.
4. Click **Ear-Tune**.

The EarTune will:
- Read the active tab's content.
- Read the StyleProfile and EarTune instructions for context.
- Propose rhythmic rewrites via the Gemini API.
- Apply each rewrite directly to the tab using the Docs API.
- Highlight changed passages in yellow and add comments with the reasoning.

### Generate (EarTune Instructions)

Click **Generate** to regenerate the EarTune system prompt:

1. The EarTune reads the current StyleProfile.
2. It produces updated EarTune instructions that incorporate the rhythm and cadence patterns specific to your manuscript.
3. The result is written to an **EarTune Scratch** review tab.

Review and accept or edit the instructions before the next Ear-Tune run.

## Comment Routing: `@eartune` or `@eartune`

You can invoke the EarTune from a comment:

1. Select a passage.
2. Add a comment:
   ```
   @eartune Smooth out the consonant cluster in this sentence.
   ```
   or:
   ```
   @eartune This paragraph reads too monotonously — add rhythm variation.
   ```
3. Click **Process @AI Comments**.

The EarTune will:
- Read the StyleProfile and EarTune instructions.
- If possible, identify which tab contains the selected passage (anchor tab resolution).
- Build a prompt targeting the specific passage with your instruction.
- Apply content rewrites and post a reply summarising changes.

## When to Run

- **After finalising content** — run Ear-Tune on each chapter tab once the prose is stable.
- **After StyleProfile changes** — regenerate EarTune instructions so the EarTune reflects your updated style.
- **On selected passages via comments** — for targeted rhythmic fixes.

## What It Reads

| Tab | Why |
|---|---|
| StyleProfile | Voice and rhythm constraints |
| EarTune | Specific sonic optimisation rules |
| Active tab / anchor tab | The prose to optimise |

## Model Tier

Uses **Fast** — prose styling is a high-throughput task where low latency matters more than deep reasoning.

---

# Logical Auditor (Technical Audit)

## What It Does

The Logical Auditor verifies that your manuscript is internally consistent. It checks:

1. **Axiom consistency** — every claim is consistent with the Chid Axiom and other principles stated in the manuscript.
2. **LaTeX captions** — all equations have proper LaTeX captions.
3. **Physical constants** — unit systems and constant values are consistent throughout.

## Sidebar Actions

### Audit (Active Tab)

This is the primary auditing action:

1. Navigate to the tab you want to audit (e.g., a chapter tab).
2. Open the sidebar and find the **Logical Auditor** section.
3. The sidebar shows "Active tab: Chapter 3". Click the **↻** button to refresh if needed.
4. Click **Audit**.

The Auditor will:
- Read the active tab's content.
- Read the StyleProfile and TechnicalAudit instructions for audit rules.
- Send the passage to Gemini (thinking tier) for thorough analysis.
- Apply corrections directly to the tab where issues are found.
- Highlight each corrected passage in yellow and add a comment citing the specific axiom or rule violated.

### Generate (Audit Instructions)

Click **Generate** to regenerate the TechnicalAudit system prompt:

1. The Auditor reads the current StyleProfile, any existing audit instructions, and a sample of the Manuscript.
2. It produces comprehensive audit rules: Chid Axioms, LaTeX caption requirements, unit systems, and a checklist.
3. The result is written to a **TechnicalAudit Scratch** review tab.

Review and accept the instructions before running audits.

## Comment Routing: `@audit` or `@auditor`

You can invoke the Auditor from a comment:

1. Select a passage containing a claim, equation, or physical constant.
2. Add a comment:
   ```
   @audit Verify the Hamiltonian notation is correct here.
   ```
   or:
   ```
   @auditor Does this claim contradict the Chid Axiom from Chapter 2?
   ```
3. Click **Process @AI Comments**.

The Auditor will:
- Read the StyleProfile and TechnicalAudit instructions.
- Identify the anchor tab if possible.
- Perform a targeted technical audit of the selected passage.
- Apply corrections and post a reply summarising issues found.

## When to Run

- **Before finalising a chapter** — run a full audit to catch inconsistencies.
- **After changing axioms or definitions** — regenerate audit instructions, then re-audit affected chapters.
- **On specific claims via comments** — for targeted verification.

## What It Reads

| Tab | Why |
|---|---|
| StyleProfile | Document's axiom framework |
| TechnicalAudit | Specific audit rules and checklists |
| Active tab / anchor tab | The passage to audit |

## Model Tier

Uses **Thinking** (extended reasoning) — technical auditing requires step-by-step reasoning about axiom consistency and mathematical correctness.

---

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
- Routes `@architect`, `@eartune`, `@eartune`, `@audit`, `@auditor` to their respective agents.
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
| `@tether` | External Anchor | Factual validation or alignment opportunity |
| `@ref` | External Anchor | Alias for `@tether` |

All tags are case-insensitive: `@AI`, `@ai`, `@Ai` all work.

## Tips

- **Be specific.** "@AI Clarify the use of 'superposition' in line 3" is better than "@AI Fix this."
- **Select the relevant text** before commenting — this gives every agent richer context.
- **Check the status bar** after processing. It shows how many threads were replied to and how many were skipped.
- **Review AI replies** — they are posted as regular Drive comments. You can delete or resolve them like any other comment.

## Model Tier

Uses **Fast** — comment responses should be quick and conversational.

---

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

---

# Troubleshooting

## Common Errors

### "Gemini API key not set"

**Cause:** No API key is configured in either script properties or user properties.

**Fix:** Open the sidebar > Setup > **Set API Key**. Paste your Gemini API key.

### "Model X is not available or has been deprecated"

**Cause:** The configured Gemini model name is no longer valid.

**Fix:**
1. Open the sidebar > Model Configuration.
2. Click **Refresh List** to fetch current models.
3. Select a valid model for the tier that errored.
4. Click **Save**.

The error message includes a list of available models to help you choose.

### "Manuscript tab is empty"

**Cause:** The Structural Architect was run before merging any tabs.

**Fix:** Use the Tab Merger to merge your chapter tabs into Manuscript first, then rerun the Architect.

### "Tab X not found"

**Cause:** A tab referenced by an agent doesn't exist in the document.

**Fix:** Click **Initialize Tabs** in the Setup section to create missing standard tabs.

### "Click ↻ to detect the active tab first"

**Cause:** You clicked Ear-Tune or Audit without first refreshing the active tab.

**Fix:** Click the **↻** button next to the active tab label, wait for it to show the correct tab name, then click the action button.

### Ear-Tune or Audit shows no changes

**Cause:** The agent's match_text didn't find the target passage. This happens when Gemini returns a slightly different string than what's actually in the document.

**Fix:** This is a known limitation of text-matching. Check the Apps Script logs (View > Logs in the script editor) for "match_text not found" warnings.

### Log Sidebar shows no output

**Cause:** The log ring buffer in CacheService is empty or has expired (entries are evicted after 6 hours).

**Possible fixes:**
- Trigger an operation (Ear-Tune, Audit) and then open the log sidebar — it only shows entries from the current session.
- If entries immediately disappear, confirm the sidebar is open *before* starting the operation so it captures entries from the beginning.
- Check Apps Script Executions (https://script.google.com) for server-side errors that may be preventing log writes.

### "Could not fetch comments"

**Cause:** The Drive API failed to list comments, typically due to a permissions issue.

**Fix:** Re-authorize the add-on by refreshing the document and accepting the permissions prompt when the EditorLLM menu loads.

### Processing comments replies to 0 threads

**Possible causes:**
- No comments have an `@tag` as the last message.
- All tagged threads have already been answered (the last message is an AI reply).
- The tag used isn't recognised (e.g., `@helper` is not a registered agent tag).

**Fix:** Check your comment threads. The last message must start with a registered tag (`@AI`, `@architect`, `@eartune`, `@ear-tune`, `@audit`, `@auditor`).

## Checking Logs

For detailed debugging, open the Apps Script editor:

1. Go to https://script.google.com
2. Open the EditorLLM project.
3. Click **Executions** in the left sidebar.
4. Find the most recent execution and click it to see logs.

Key log prefixes:
- `[CommentProcessor]` — comment routing, thread parsing, dispatch
- `[ArchitectAgent]`, `[EarTuneAgent]`, `[AuditAgent]`, `[GeneralPurposeAgent]` — per-agent Gemini calls and context
- `[DocOps]` — tab creation and registry operations

## Performance

- **First run is slow.** The standard tab creation step (Initialize Tabs) calls the Docs REST API, which takes 2-5 seconds per tab.
- **Gemini thinking tier** takes longer than fast. Architect and Auditor operations may take 15-30 seconds.
- **Large documents** are truncated. Agents read a limited number of characters from each tab (typically 6,000-12,000) to stay within API limits.
- **Many comments** are now paginated. Documents with 20+ comments fetch all pages automatically.

---

*EditorLLM — AI-augmented editing for Google Docs*
