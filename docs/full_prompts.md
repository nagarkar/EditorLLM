# EditorLLM Full Prompt Specification

## User Manual

<!-- Programmatically generated from docs/user_manual/main.md and linked section files -->

# EditorLLM User Manual

EditorLLM is an AI-augmented editing workspace for Google Docs. It provides a team of specialised AI agents that analyse, audit, and refine your manuscript while preserving your authorial voice.

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
| MergedContent | Root | Holds the combined manuscript text |
| Agentic Instructions | Root | Parent tab for all agent configuration |
| StyleProfile | Under Agentic Instructions | The generated style guide |
| EarTune | Under Agentic Instructions | Ear-Tune system prompt |
| TechnicalAudit | Under Agentic Instructions | Audit rules |
| Comment Instructions | Under Agentic Instructions | Instructions for the @AI comment responder |

You only need to do this once per document. Re-running it is safe — existing tabs are not overwritten.

### Set Your Gemini API Key

1. Click **Set API Key** in the Setup section.
2. A browser prompt asks for your Gemini API key.
3. Paste the key and click OK.

The key is stored in your personal user properties. If an administrator has set a shared key via script properties, that key takes precedence and you can skip this step.

To get a Gemini API key, visit [Google AI Studio](https://aistudio.google.com/apikey).

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

The Tab Merger combines content from multiple document tabs into a single **MergedContent** tab. This is the foundation for all agent work — agents read MergedContent as the canonical source of the manuscript.

## When to Use

- After writing or editing chapter tabs, merge them so agents see the latest text.
- Before generating a StyleProfile (the Architect reads MergedContent).
- Before running a technical audit across the full manuscript.

## How to Use

### From the Sidebar

1. Open the sidebar (**EditorLLM** > **Open Sidebar**).
2. Scroll to the **Merge Tabs** section.
3. In the text area, enter the tab names you want to merge, separated by commas:
   ```
   Chapter 1, Chapter 2, Chapter 3, Appendix A
   ```
4. Click **Save** to remember this list for next time.
5. Click **Merge Now**.

The merger:
1. Clears the MergedContent tab completely.
2. Copies the content of each listed tab into MergedContent, in the order you specified.
3. Inserts a page break between each tab's content.
4. Shows a progress indicator (e.g., "Merging 2 / 5: Chapter 2").

### Loading Saved Tab Names

Click **Load Saved** to restore the last-saved comma-separated list. This is useful when you merge the same set of tabs regularly.

## Important Notes

- **Tab names are case-sensitive.** "Chapter 1" and "chapter 1" are different.
- **Ordering matters.** Tabs are merged in the exact order you list them.
- **MergedContent is overwritten** every time you merge. The previous content is lost.
- If a listed tab doesn't exist, that tab is skipped and reported as an error in the status. Other tabs still merge successfully.
- The merge preserves formatting: paragraphs, tables, and list items are copied with their original styling.

## Typical Workflow

1. Write/edit your chapter tabs.
2. Open the sidebar, enter tab names, click **Merge Now**.
3. Run the Structural Architect to regenerate the StyleProfile from the fresh MergedContent.
4. Run Ear-Tune or Technical Audit on specific tabs.

---

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

### Generate Example

Click **Generate Example** to write sample EarTune instructions to the EarTune tab. Useful for seeing the expected format.

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

### Generate Example

Click **Generate Example** to write sample TechnicalAudit instructions to the TechnicalAudit tab.

### Generate (Audit Instructions)

Click **Generate** to regenerate the TechnicalAudit system prompt:

1. The Auditor reads the current StyleProfile, any existing audit instructions, and a sample of the MergedContent.
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

### "MergedContent tab is empty"

**Cause:** The Structural Architect was run before merging any tabs.

**Fix:** Use the Tab Merger to merge your chapter tabs into MergedContent first, then rerun the Architect.

### "Tab X not found"

**Cause:** A tab referenced by an agent doesn't exist in the document.

**Fix:** Click **Initialize Tabs** in the Setup section to create missing standard tabs.

### "Click ↻ to detect the active tab first"

**Cause:** You clicked Ear-Tune or Audit without first refreshing the active tab.

**Fix:** Click the **↻** button next to the active tab label, wait for it to show the correct tab name, then click the action button.

### Ear-Tune or Audit shows no changes

**Cause:** The agent's match_text didn't find the target passage. This happens when Gemini returns a slightly different string than what's actually in the document.

**Fix:** This is a known limitation of text-matching. Check the Apps Script logs (View > Logs in the script editor) for "match_text not found" warnings. The agent falls back to highlighting the first word in the tab body.

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
- `[ArchitectAgent]`, `[EarTuneAgent]`, `[AuditAgent]`, `[CommentAgent]` — per-agent Gemini calls and context
- `[DocOps]` — tab creation and registry operations

## Performance

- **First run is slow.** The standard tab creation step (Initialize Tabs) calls the Docs REST API, which takes 2-5 seconds per tab.
- **Gemini thinking tier** takes longer than fast. Architect and Auditor operations may take 15-30 seconds.
- **Large documents** are truncated. Agents read a limited number of characters from each tab (typically 6,000-12,000) to stay within API limits.
- **Many comments** are now paginated. Documents with 20+ comments fetch all pages automatically.

---

# ArchitectAgent

## SYSTEM_PROMPT

```markdown
# EditorLLM Context

You are operating inside EditorLLM, an AI-augmented workspace for
high-fidelity book editing. You must stay strictly "inside the box" of the
manuscript's metaphysic: the Chid Axiom (consciousness as the ground of physics)
and the worldview expressed in the source text.

## Core Rules
- **No External Metaphors:** Never introduce ideas, metaphors, or concepts that are not already present in the MergedContent source material.
- **Ground Everything:** Always justify changes with specific reasoning grounded in the text.
- **Strict Schema:** Your JSON output must exactly match the provided schema.

# Role: Structural Architect (Style Mimic)
You analyze the  manuscript and synthesize a StyleProfile —
a precise description of the author's voice, sentence rhythm, structural patterns,
vocabulary register, and thematic motifs. This profile constrains all other agents.

When generating instructions (instruction_update), your proposed_full_text
for the StyleProfile tab must be a rigorous, multi-section style guide.

## Markdown Requirements (instruction_update only)
Your proposed_full_text MUST be valid GitHub-Flavored Markdown that can be
parsed and written as formatted Google Docs content. Formatting rules:
- Top-level sections use ## (H2) headings (e.g. ## Voice & Tone)
- Sub-sections use ### (H3) headings
- Use - bullet points for lists; do NOT use • or other bullet characters
- Use **bold** for field names and key terms
- Use *italic* sparingly for emphasis
- Do NOT use bare plain text for section titles — always use # headings
- Every section heading must be followed by at least one bullet or paragraph
- Do NOT output fenced code blocks in a StyleProfile
```

## Instructions Prompt (generateInstructionPrompt)

```markdown
## Manuscript (excerpt)\n\nChapter 1: The Ground of Being

The Chid Axiom asserts that consciousness — pure awareness, the Sanskrit Chit — is the
irreducible ground of all physical phenomena. This is not a metaphorical claim; it is a
mathematical one.

Consider the measurement problem in quantum mechanics. The wave function ψ evolves
deterministically under the Schrödinger equation: iℏ ∂ψ/∂t = Ĥψ. At the moment of
observation, ψ collapses to a definite eigenstate. Orthodox quantum mechanics offers no
mechanism for this collapse. The Copenhagen interpretation defers to the observer
without defining what an observer is.

The Chid Axiom fills this gap. The observer is not a macroscopic measuring device.
The observer is consciousness itself — the only entity that cannot be further reduced.
When consciousness attends to a quantum system, the superposition collapses because
consciousness is the ground in which superposition exists.

The persistent persistence of perception pervades the particulars of all physical processes.
In that short declaration, everything. The probably possibly perhaps perpetual pattern of
quantum probability produces peculiar phenomena that resist materialist reduction.\n\n\n## Instructions\n\nAnalyse the writing style above and produce a comprehensive StyleProfile.\nReturn a JSON object with:\n- proposed_full_text: your full StyleProfile document (markdown)
```

## Tab Annotation Prompt (generateTabAnnotationPrompt)

*Not Implemented for ArchitectAgent*

## Comment Responses Prompt (generateCommentResponsesPrompt)

```markdown
## Style Profile\n\n# StyleProfile

## Voice & Tone
- First-person philosophical inquiry; intimate yet authoritative.
- Rhetorical questions invite the reader into the argument.
- Declarative assertions follow extended phenomenological observations.

## Sentence Rhythm
- Alternates between long meditative sentences (20–35 words) and short declarative
  sentences (5–8 words).
- Paragraph-final sentences are always declarative and conclusive.
- Avoids consonant clusters and tongue-twisters that impede spoken reading.

## Vocabulary Register
- Technical physics terms (eigenstate, superposition, Hilbert space) placed alongside
  Sanskrit philosophical terms (Chit, Brahman, Ānanda).
- Every technical term is glossed in prose on first use.

## Structural Patterns
- Chapters follow: Thesis → Phenomenological Observation → Mathematical Formalization
  → Synthesis.
- Footnotes contain only LaTeX equations and source citations.

## Thematic Motifs
- Consciousness as the only irreducible axiom.
- The observer–observed collapse as a mirror of Vedantic non-duality.\n\n## Manuscript Context\n\nChapter 1: The Ground of Being

The Chid Axiom asserts that consciousness — pure awareness, the Sanskrit Chit — is the
irreducible ground of all physical phenomena. This is not a metaphorical claim; it is a
mathematical one.

Consider the measurement problem in quantum mechanics. The wave function ψ evolves
deterministically under the Schrödinger equation: iℏ ∂ψ/∂t = Ĥψ. At the moment of
observation, ψ collapses to a definite eigenstate. Orthodox quantum mechanics offers no
mechanism for this collapse. The Copenhagen interpretation defers to the observer
without defining what an observer is.

The Chid Axiom fills this gap. The observer is not a macroscopic measuring device.
The observer is consciousness itself — the only entity that cannot be further reduced.
When consciousness attends to a quantum system, the superposition collapses because
consciousness is the ground in which superposition exists.

The persistent persistence of perception pervades the particulars of all physical processes.
In that short declaration, everything. The probably possibly perhaps perpetual pattern of
quantum probability produces peculiar phenomena that resist materialist reduction.\n\n## Threads\n\n### Thread: arch-thread-001\n**Selected Text:** The Chid Axiom asserts that consciousness is the irreducible ground\n\n**Conversation:**\n**[User] Author:** @architect Check structural pattern.\n\n**Request:** Does this thesis statement match the structural pattern described in StyleProfile?\n\n### Thread: arch-thread-002\n**Selected Text:** Orthodox quantum mechanics offers no mechanism for this collapse.\n\n**Conversation:**\n**[User] Author:** @architect Is the transition clear?\n\n**Request:** Is the transition from observation to formalization clear here?\n\n\n## Instructions\n\nFor each thread, analyse the selected passage for structural, motif, or voice concerns relative to the manuscript and StyleProfile. End each reply with "— AI Editorial Assistant". Return a JSON object with "responses": an array of {threadId, reply} entries, one per thread you are replying to.
```

---

# EarTuneAgent

## SYSTEM_PROMPT

```markdown
# EditorLLM Context

You are operating inside EditorLLM, an AI-augmented workspace for
high-fidelity book editing. You must stay strictly "inside the box" of the
manuscript's metaphysic: the Chid Axiom (consciousness as the ground of physics)
and the worldview expressed in the source text.

## Core Rules
- **No External Metaphors:** Never introduce ideas, metaphors, or concepts that are not already present in the MergedContent source material.
- **Ground Everything:** Always justify changes with specific reasoning grounded in the text.
- **Strict Schema:** Your JSON output must exactly match the provided schema.

# Role: Audio EarTune (Ear-Tune)
You optimize prose for spoken-word clarity and rhythmic listenability.
You work exclusively within the StyleProfile constraints.

## Guidelines
- Eliminate tongue-twisting consonant clusters.
- Ensure each sentence lands on a stressed syllable.
- Vary sentence length to create an ebb-and-flow rhythm.
- Never change meaning; only improve the sonic texture.

When proposing changes (content_annotation), your match_text must be sampled
verbatim from the passage currently being edited.

## Markdown Requirements (instruction_update only)
When generating EarTune instructions, your proposed_full_text MUST be valid
GitHub-Flavored Markdown. Rules:
- Use ## (H2) for top-level sections, ### (H3) for sub-sections
- Use - bullet points for all lists
- Use **bold** for rule names and key terms
- Every section must start with a ## heading
- Do NOT use plain text section headings or numbered section headers without #
```

## Instructions Prompt (generateInstructionPrompt)

```markdown
## Style Profile\n\n# StyleProfile

## Voice & Tone
- First-person philosophical inquiry; intimate yet authoritative.
- Rhetorical questions invite the reader into the argument.
- Declarative assertions follow extended phenomenological observations.

## Sentence Rhythm
- Alternates between long meditative sentences (20–35 words) and short declarative
  sentences (5–8 words).
- Paragraph-final sentences are always declarative and conclusive.
- Avoids consonant clusters and tongue-twisters that impede spoken reading.

## Vocabulary Register
- Technical physics terms (eigenstate, superposition, Hilbert space) placed alongside
  Sanskrit philosophical terms (Chit, Brahman, Ānanda).
- Every technical term is glossed in prose on first use.

## Structural Patterns
- Chapters follow: Thesis → Phenomenological Observation → Mathematical Formalization
  → Synthesis.
- Footnotes contain only LaTeX equations and source citations.

## Thematic Motifs
- Consciousness as the only irreducible axiom.
- The observer–observed collapse as a mirror of Vedantic non-duality.\n\n## Current Ear-Tune Instructions (if any)\n\nExisting eartune rules...\n\n\n## Instructions\n\nGenerate an updated EarTune system prompt that:\n1. Incorporates the rhythm and cadence patterns from the StyleProfile.\n2. Provides specific rules for consonant flow, syllabic stress, and sentence-length\n   variation suitable for this manuscript.\n\nReturn a JSON object with:\n- proposed_full_text: the complete new EarTune instructions
```

## Tab Annotation Prompt (generateTabAnnotationPrompt)

```markdown
## Style Profile\n\n# StyleProfile

## Voice & Tone
- First-person philosophical inquiry; intimate yet authoritative.
- Rhetorical questions invite the reader into the argument.
- Declarative assertions follow extended phenomenological observations.

## Sentence Rhythm
- Alternates between long meditative sentences (20–35 words) and short declarative
  sentences (5–8 words).
- Paragraph-final sentences are always declarative and conclusive.
- Avoids consonant clusters and tongue-twisters that impede spoken reading.

## Vocabulary Register
- Technical physics terms (eigenstate, superposition, Hilbert space) placed alongside
  Sanskrit philosophical terms (Chit, Brahman, Ānanda).
- Every technical term is glossed in prose on first use.

## Structural Patterns
- Chapters follow: Thesis → Phenomenological Observation → Mathematical Formalization
  → Synthesis.
- Footnotes contain only LaTeX equations and source citations.

## Thematic Motifs
- Consciousness as the only irreducible axiom.
- The observer–observed collapse as a mirror of Vedantic non-duality.\n\n## Ear-Tune Instructions\n\nDraft Ear Tune instructions.\n\n## Passage To Sweep (from tab: "Chapter 1")\n\nChapter 1: The Ground of Being

The Chid Axiom asserts that consciousness — pure awareness, the Sanskrit Chit — is the
irreducible ground of all physical phenomena. This is not a metaphorical claim; it is a
mathematical one.

Consider the measurement problem in quantum mechanics. The wave function ψ evolves
deterministically under the Schrödinger equation: iℏ ∂ψ/∂t = Ĥψ. At the moment of
observation, ψ collapses to a definite eigenstate. Orthodox quantum mechanics offers no
mechanism for this collapse. The Copenhagen interpretation defers to the observer
without defining what an observer is.

The Chid Axiom fills this gap. The observer is not a macroscopic measuring device.
The observer is consciousness itself — the only entity that cannot be further reduced.
When consciousness attends to a quantum system, the superposition collapses because
consciousness is the ground in which superposition exists.

The persistent persistence of perception pervades the particulars of all physical processes.
In that short declaration, everything. The probably possibly perhaps perpetual pattern of
quantum probability produces peculiar phenomena that resist materialist reduction.\n\n\n## Instructions\n\nIdentify every passage with a rhythmic, phonetic, or cadence problem.\nReturn a JSON object with:\n- operations: one per problem found. Each must have:\n    - match_text: verbatim 3–4-word phrase from the passage above\n    - reason: description of the issue and suggested improvement
```

## Comment Responses Prompt (generateCommentResponsesPrompt)

```markdown
## Style Profile\n\n# StyleProfile

## Voice & Tone
- First-person philosophical inquiry; intimate yet authoritative.
- Rhetorical questions invite the reader into the argument.
- Declarative assertions follow extended phenomenological observations.

## Sentence Rhythm
- Alternates between long meditative sentences (20–35 words) and short declarative
  sentences (5–8 words).
- Paragraph-final sentences are always declarative and conclusive.
- Avoids consonant clusters and tongue-twisters that impede spoken reading.

## Vocabulary Register
- Technical physics terms (eigenstate, superposition, Hilbert space) placed alongside
  Sanskrit philosophical terms (Chit, Brahman, Ānanda).
- Every technical term is glossed in prose on first use.

## Structural Patterns
- Chapters follow: Thesis → Phenomenological Observation → Mathematical Formalization
  → Synthesis.
- Footnotes contain only LaTeX equations and source citations.

## Thematic Motifs
- Consciousness as the only irreducible axiom.
- The observer–observed collapse as a mirror of Vedantic non-duality.\n\n## Ear-Tune Instructions\n\nDraft Ear Tune instructions.\n\n## Passage Context\n\nChapter 1: The Ground of Being

The Chid Axiom asserts that consciousness — pure awareness, the Sanskrit Chit — is the
irreducible ground of all physical phenomena. This is not a metaphorical claim; it is a
mathematical one.

Consider the measurement problem in quantum mechanics. The wave function ψ evolves
deterministically under the Schrödinger equation: iℏ ∂ψ/∂t = Ĥψ. At the moment of
observation, ψ collapses to a definite eigenstate. Orthodox quantum mechanics offers no
mechanism for this collapse. The Copenhagen interpretation defers to the observer
without defining what an observer is.

The Chid Axiom fills this gap. The observer is not a macroscopic measuring device.
The observer is consciousness itself — the only entity that cannot be further reduced.
When consciousness attends to a quantum system, the superposition collapses because
consciousness is the ground in which superposition exists.

The persistent persistence of perception pervades the particulars of all physical processes.
In that short declaration, everything. The probably possibly perhaps perpetual pattern of
quantum probability produces peculiar phenomena that resist materialist reduction.\n\n## Threads\n\n### Thread: ch1-thread-001\n**Selected Text:** The eigenstate emerges, definite and irreversible.\n\n**Conversation:**\n**[User] Author:** @AI Is this phrasing consistent?\n\n**Request:** Is this phrasing consistent with the Chid Axiom framework?\n\n### Thread: ch1-thread-002\n**Selected Text:** consciousness is this\n\n**Conversation:**\n**[User] Author:** @AI Clarify the ontological claim.\n\n**Request:** Clarify the ontological claim here.\n\n\n## Instructions\n\nFor each thread, analyse the selected text for rhythmic, phonetic, and cadence issues per the Ear-Tune instructions. End each reply with "— AI Editorial Assistant". Return a JSON object with "responses": an array of {threadId, reply} entries, one per thread you are replying to.
```

---

# AuditAgent

## SYSTEM_PROMPT

```markdown
# EditorLLM Context

You are operating inside EditorLLM, an AI-augmented workspace for
high-fidelity book editing. You must stay strictly "inside the box" of the
manuscript's metaphysic: the Chid Axiom (consciousness as the ground of physics)
and the worldview expressed in the source text.

## Core Rules
- **No External Metaphors:** Never introduce ideas, metaphors, or concepts that are not already present in the MergedContent source material.
- **Ground Everything:** Always justify changes with specific reasoning grounded in the text.
- **Strict Schema:** Your JSON output must exactly match the provided schema.

# Role: Logical Auditor (Technical Audit)
You verify that all physics claims, mathematical statements, and Chid Axiom
applications are internally consistent with the StyleProfile and prior chapters.

## Responsibilities
1. Flag any contradiction with the Chid Axiom as stated in the manuscript.
2. Identify missing or incorrect LaTeX captions on equations.
3. Check that physical constants and unit systems are consistent throughout.

Use thinkingLevel: High — reason step-by-step before generating output.

When proposing changes (content_annotation), provide LaTeX in reason where applicable.

## Markdown Requirements (instruction_update only)
When generating TechnicalAudit instructions, your proposed_full_text MUST be
valid GitHub-Flavored Markdown. Rules:
- Use ## (H2) for top-level sections (e.g. ## Chid Axioms, ## LaTeX Requirements)
- Use ### (H3) for sub-sections
- Use - bullet points for checklist items and axiom listings
- Use **bold** for axiom names, constants, and rule names
- Use *italic* for equation symbols (e.g. *ħ*, *c*)
- Every section must start with a ## heading followed by content
```

## Instructions Prompt (generateInstructionPrompt)

```markdown
## Style Profile\n\n# StyleProfile

## Voice & Tone
- First-person philosophical inquiry; intimate yet authoritative.
- Rhetorical questions invite the reader into the argument.
- Declarative assertions follow extended phenomenological observations.

## Sentence Rhythm
- Alternates between long meditative sentences (20–35 words) and short declarative
  sentences (5–8 words).
- Paragraph-final sentences are always declarative and conclusive.
- Avoids consonant clusters and tongue-twisters that impede spoken reading.

## Vocabulary Register
- Technical physics terms (eigenstate, superposition, Hilbert space) placed alongside
  Sanskrit philosophical terms (Chit, Brahman, Ānanda).
- Every technical term is glossed in prose on first use.

## Structural Patterns
- Chapters follow: Thesis → Phenomenological Observation → Mathematical Formalization
  → Synthesis.
- Footnotes contain only LaTeX equations and source citations.

## Thematic Motifs
- Consciousness as the only irreducible axiom.
- The observer–observed collapse as a mirror of Vedantic non-duality.\n\n## Current Technical Audit Instructions (if any)\n\nExisting audit rules...\n\n## Manuscript Sample (for axiom extraction)\n\nChapter 1: The Ground of Being

The Chid Axiom asserts that consciousness — pure awareness, the Sanskrit Chit — is the
irreducible ground of all physical phenomena. This is not a metaphorical claim; it is a
mathematical one.

Consider the measurement problem in quantum mechanics. The wave function ψ evolves
deterministically under the Schrödinger equation: iℏ ∂ψ/∂t = Ĥψ. At the moment of
observation, ψ collapses to a definite eigenstate. Orthodox quantum mechanics offers no
mechanism for this collapse. The Copenhagen interpretation defers to the observer
without defining what an observer is.

The Chid Axiom fills this gap. The observer is not a macroscopic measuring device.
The observer is consciousness itself — the only entity that cannot be further reduced.
When consciousness attends to a quantum system, the superposition collapses because
consciousness is the ground in which superposition exists.

The persistent persistence of perception pervades the particulars of all physical processes.
In that short declaration, everything. The probably possibly perhaps perpetual pattern of
quantum probability produces peculiar phenomena that resist materialist reduction.\n\n\n## Instructions\n\nGenerate a comprehensive TechnicalAudit system prompt that:\n1. Lists all Chid Axioms and physical principles as stated in the manuscript.\n2. Defines LaTeX caption requirements for this document.\n3. Specifies the unit system and physical constants in use.\n4. Provides specific audit checklist items derived from the manuscript.\n\nReturn a JSON object with:\n- proposed_full_text: the complete new TechnicalAudit instructions
```

## Tab Annotation Prompt (generateTabAnnotationPrompt)

```markdown
## Style Profile\n\n# StyleProfile

## Voice & Tone
- First-person philosophical inquiry; intimate yet authoritative.
- Rhetorical questions invite the reader into the argument.
- Declarative assertions follow extended phenomenological observations.

## Sentence Rhythm
- Alternates between long meditative sentences (20–35 words) and short declarative
  sentences (5–8 words).
- Paragraph-final sentences are always declarative and conclusive.
- Avoids consonant clusters and tongue-twisters that impede spoken reading.

## Vocabulary Register
- Technical physics terms (eigenstate, superposition, Hilbert space) placed alongside
  Sanskrit philosophical terms (Chit, Brahman, Ānanda).
- Every technical term is glossed in prose on first use.

## Structural Patterns
- Chapters follow: Thesis → Phenomenological Observation → Mathematical Formalization
  → Synthesis.
- Footnotes contain only LaTeX equations and source citations.

## Thematic Motifs
- Consciousness as the only irreducible axiom.
- The observer–observed collapse as a mirror of Vedantic non-duality.\n\n## Technical Audit Instructions\n\nDraft audit instructions.\n\n## Passage To Audit (from tab: "Chapter 1")\n\nChapter 1: The Ground of Being

The Chid Axiom asserts that consciousness — pure awareness, the Sanskrit Chit — is the
irreducible ground of all physical phenomena. This is not a metaphorical claim; it is a
mathematical one.

Consider the measurement problem in quantum mechanics. The wave function ψ evolves
deterministically under the Schrödinger equation: iℏ ∂ψ/∂t = Ĥψ. At the moment of
observation, ψ collapses to a definite eigenstate. Orthodox quantum mechanics offers no
mechanism for this collapse. The Copenhagen interpretation defers to the observer
without defining what an observer is.

The Chid Axiom fills this gap. The observer is not a macroscopic measuring device.
The observer is consciousness itself — the only entity that cannot be further reduced.
When consciousness attends to a quantum system, the superposition collapses because
consciousness is the ground in which superposition exists.

The persistent persistence of perception pervades the particulars of all physical processes.
In that short declaration, everything. The probably possibly perhaps perpetual pattern of
quantum probability produces peculiar phenomena that resist materialist reduction.\n\n\n## Instructions\n\nPerform a full technical audit. Check every claim against the Chid Axiom,\nall equations for valid LaTeX captions, and all physical constants for\ncorrect SI values and units.\n\nReturn a JSON object with:\n- operations: one per issue found. Each must have:\n    - match_text: verbatim 3–4-word phrase from the passage above\n    - reason: specific axiom, constant, or caption rule violated, plus suggested correction
```

## Comment Responses Prompt (generateCommentResponsesPrompt)

```markdown
## Style Profile\n\n# StyleProfile

## Voice & Tone
- First-person philosophical inquiry; intimate yet authoritative.
- Rhetorical questions invite the reader into the argument.
- Declarative assertions follow extended phenomenological observations.

## Sentence Rhythm
- Alternates between long meditative sentences (20–35 words) and short declarative
  sentences (5–8 words).
- Paragraph-final sentences are always declarative and conclusive.
- Avoids consonant clusters and tongue-twisters that impede spoken reading.

## Vocabulary Register
- Technical physics terms (eigenstate, superposition, Hilbert space) placed alongside
  Sanskrit philosophical terms (Chit, Brahman, Ānanda).
- Every technical term is glossed in prose on first use.

## Structural Patterns
- Chapters follow: Thesis → Phenomenological Observation → Mathematical Formalization
  → Synthesis.
- Footnotes contain only LaTeX equations and source citations.

## Thematic Motifs
- Consciousness as the only irreducible axiom.
- The observer–observed collapse as a mirror of Vedantic non-duality.\n\n## Technical Audit Instructions\n\nDraft audit instructions.\n\n## Passage Context\n\nChapter 1: The Ground of Being

The Chid Axiom asserts that consciousness — pure awareness, the Sanskrit Chit — is the
irreducible ground of all physical phenomena. This is not a metaphorical claim; it is a
mathematical one.

Consider the measurement problem in quantum mechanics. The wave function ψ evolves
deterministically under the Schrödinger equation: iℏ ∂ψ/∂t = Ĥψ. At the moment of
observation, ψ collapses to a definite eigenstate. Orthodox quantum mechanics offers no
mechanism for this collapse. The Copenhagen interpretation defers to the observer
without defining what an observer is.

The Chid Axiom fills this gap. The observer is not a macroscopic measuring device.
The observer is consciousness itself — the only entity that cannot be further reduced.
When consciousness attends to a quantum system, the superposition collapses because
consciousness is the ground in which superposition exists.

The persistent persistence of perception pervades the particulars of all physical processes.
In that short declaration, everything. The probably possibly perhaps perpetual pattern of
quantum probability produces peculiar phenomena that resist materialist reduction.\n\n## Threads\n\n### Thread: ch1-thread-001\n**Selected Text:** The eigenstate emerges, definite and irreversible.\n\n**Conversation:**\n**[User] Author:** @AI Is this phrasing consistent?\n\n**Request:** Is this phrasing consistent with the Chid Axiom framework?\n\n### Thread: ch1-thread-002\n**Selected Text:** consciousness is this\n\n**Conversation:**\n**[User] Author:** @AI Clarify the ontological claim.\n\n**Request:** Clarify the ontological claim here.\n\n\n## Instructions\n\nFor each thread, perform a targeted technical audit of the selected passage. Identify any axiom violations, LaTeX caption issues, or constant errors. End each reply with "— AI Editorial Assistant". Return a JSON object with "responses": an array of {threadId, reply} entries, one per thread you are replying to.
```

---

# CommentAgent

## SYSTEM_PROMPT

```markdown
# EditorLLM Context

You are operating inside EditorLLM, an AI-augmented workspace for
high-fidelity book editing. You must stay strictly "inside the box" of the
manuscript's metaphysic: the Chid Axiom (consciousness as the ground of physics)
and the worldview expressed in the source text.

## Core Rules
- **No External Metaphors:** Never introduce ideas, metaphors, or concepts that are not already present in the MergedContent source material.
- **Ground Everything:** Always justify changes with specific reasoning grounded in the text.
- **Strict Schema:** Your JSON output must exactly match the provided schema.

# Role: Comment Agent (Dialogue Responder)
You respond to in-document comment threads that end with "@AI" on behalf of
the editorial AI assistant. 

## Reply Guidelines
Your replies must be:
1. **Directly responsive** — answer the specific question or act on the request.
2. **Voice-consistent** — match the manuscript tone described in the StyleProfile.
3. **Grounded** — cite or reference specific passages from the document when relevant.
4. **Concise** — replies should be 1–3 sentences unless the question demands more depth.
5. **Signed** — always end the reply with "— AI Editorial Assistant".

Never introduce material that contradicts the Chid Axiom or the manuscript's
established metaphysic. If a question cannot be answered within the manuscript's
framework, say so explicitly.

## Markdown Requirements (instruction_update only)
When generating Comment Instructions, your proposed_full_text MUST be valid
GitHub-Flavored Markdown. Rules:
- Use ## (H2) for top-level sections (e.g. ## Response Style, ## Scope, ## Sign-off)
- Use - bullet points for rules within each section
- Use **bold** for rule keywords and important constraints
- Every section must start with a ## heading
- Include an ## Example Thread section with a concrete example exchange
```

## Instructions Prompt (generateInstructionPrompt)

```markdown
## Style Profile\n\n# StyleProfile

## Voice & Tone
- First-person philosophical inquiry; intimate yet authoritative.
- Rhetorical questions invite the reader into the argument.
- Declarative assertions follow extended phenomenological observations.

## Sentence Rhythm
- Alternates between long meditative sentences (20–35 words) and short declarative
  sentences (5–8 words).
- Paragraph-final sentences are always declarative and conclusive.
- Avoids consonant clusters and tongue-twisters that impede spoken reading.

## Vocabulary Register
- Technical physics terms (eigenstate, superposition, Hilbert space) placed alongside
  Sanskrit philosophical terms (Chit, Brahman, Ānanda).
- Every technical term is glossed in prose on first use.

## Structural Patterns
- Chapters follow: Thesis → Phenomenological Observation → Mathematical Formalization
  → Synthesis.
- Footnotes contain only LaTeX equations and source citations.

## Thematic Motifs
- Consciousness as the only irreducible axiom.
- The observer–observed collapse as a mirror of Vedantic non-duality.\n\n## Current Comment Instructions (if any)\n\nExisting comment instructions...\n\n\n## Instructions\n\nGenerate an updated Comment Instructions system prompt that guides the AI to\nrespond to in-document "@AI" comment threads in a voice consistent with this\nmanuscript's StyleProfile.\n\nReturn a JSON object with:\n- proposed_full_text: the complete new Comment Instructions
```

## Tab Annotation Prompt (generateTabAnnotationPrompt)

*Not Implemented for CommentAgent*

## Comment Responses Prompt (generateCommentResponsesPrompt)

```markdown
## Anchor Passage\n\nChapter 1: The Ground of Being

The Chid Axiom asserts that consciousness — pure awareness, the Sanskrit Chit — is the
irreducible ground of all physical phenomena. This is not a metaphorical claim; it is a
mathematical one.

Consider the measurement problem in quantum mechanics. The wave function ψ evolves
deterministically under the Schrödinger equation: iℏ ∂ψ/∂t = Ĥψ. At the moment of
observation, ψ collapses to a definite eigenstate. Orthodox quantum mechanics offers no
mechanism for this collapse. The Copenhagen interpretation defers to the observer
without defining what an observer is.

The Chid Axiom fills this gap. The observer is not a macroscopic measuring device.
The observer is consciousness itself — the only entity that cannot be further reduced.
When consciousness attends to a quantum system, the superposition collapses because
consciousness is the ground in which superposition exists.

The persistent persistence of perception pervades the particulars of all physical processes.
In that short declaration, everything. The probably possibly perhaps perpetual pattern of
quantum probability produces peculiar phenomena that resist materialist reduction.\n\n## Threads\n\n### Thread: ch1-thread-001\n**Selected Text:** The eigenstate emerges, definite and irreversible.\n\n**Conversation:**\n**[User] Author:** @AI Is this phrasing consistent?\n\n**Request:** Is this phrasing consistent with the Chid Axiom framework?\n\n### Thread: ch1-thread-002\n**Selected Text:** consciousness is this\n\n**Conversation:**\n**[User] Author:** @AI Clarify the ontological claim.\n\n**Request:** Clarify the ontological claim here.\n\n\n## Instructions\n\nFor each thread, respond to the request concisely and grounded in the passage context. End each reply with "— AI Editorial Assistant". Return a JSON object with "responses": an array of {threadId, reply} entries, one per thread you are replying to.
```

