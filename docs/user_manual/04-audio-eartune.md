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

1. The EarTune reads the current **StyleProfile** and your **existing EarTune** instructions.
2. It produces updated EarTune instructions that incorporate the rhythm and cadence patterns specific to your manuscript.
3. The result is written directly to the **EarTune** tab, with your previous version backed up to **EarTune Scratch**.

Manual refinements you make to the EarTune tab are preserved and refined in subsequent generations (recursive feedback).

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

| Workflow | Tab | Format | Why |
|---|---|---|---|
| **Generate (W1)** | StyleProfile | Markdown | Voice and rhythm patterns to mirror |
| **Generate (W1)** | EarTune | Markdown | Existing rules to be refined |
| **Ear-Tune (W2)** | StyleProfile | Plain Text | Voice and rhythm constraints |
| **Ear-Tune (W2)** | EarTune | Plain Text | Sonic optimization rules |
| **Ear-Tune (W2)** | Active Tab | Plain Text | The prose to optimize |
| **Comments (W3)** | StyleProfile | Plain Text | Voice and rhythm constraints |
| **Comments (W3)** | EarTune | Plain Text | Sonic optimization rules |
| **Comments (W3)** | Anchor Tab | Plain Text | Passage context for the comment |

## Model Tier

Uses **Fast** — prose styling is a high-throughput task where low latency matters more than deep reasoning.
