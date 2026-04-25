# External Anchor (Tether Agent)

## What It Does

The Tether Agent acts as the **External Anchor** for the manuscript. While other agents stay "inside the box" of the author's established metaphysic (the Chid Axiom), the Tether Agent bridges that worldview with the external historical and scientific record. It ensures that references to historical figures (e.g., Schrödinger, Epictetus) and scientific facts are accurate, or at least consciously handled as internal developments.

## Sidebar Actions

### Verify (Active Tab)

This is the primary validation action:

1. Navigate to the tab you want to validate.
2. Open the sidebar and find the **External Anchor** section.
3. Click **Verify**.

The Tether Agent will:
- Read the active tab's content.
- Read the StyleProfile and TetherInstructions for context.
- Perform an external source validation sweep.
- Apply corrections directly to the tab.
- Highlight changed passages in yellow and add comments identifying factual discrepancies or alignment opportunities.

### Generate (Tether Instructions)

Click **Generate** to regenerate the Tether Instructions system prompt:

1. The Tether Agent reads the current **StyleProfile**, your **existing** tether instructions, and a sample of the **Manuscript**.
2. It identifies key historical figures and texts cited in the manuscript.
3. It produces comprehensive instructions for source validation and alignment checklists.
4. The result is written directly to the **TetherInstructions** tab, with the previous version backed up to **TetherInstructions Scratch**.

## Comment Routing: `@tether` or `@ref`

You can invoke the Tether Agent from a comment:

1. Select a passage containing a citation or historical claim.
2. Add a comment:
   ```
   @tether Is this quote actually from the Rig Veda?
   ```
   or:
   ```
   @ref Ensure the Schrödinger equation notation here is standard.
   ```
3. Click **Process @AI Comments**.

The Tether Agent will perform a targeted validation and post a reply.

## What It Reads

### During Instruction Generation (Generate button)

| Tab | Format | Why |
|---|---|---|
| StyleProfile | Markdown | Voice and conceptual framework |
| Manuscript | Plain Text | Manuscript sample (first 6,000 chars) for fact-checking context |
| TetherInstructions | Markdown | Existing rules to be refined |

### During Tab Validation (Verify button)

| Tab | Format | Why |
|---|---|---|
| StyleProfile | Plain Text | Manuscript's conceptual boundaries |
| TetherInstructions | Plain Text | Validation rules and checklists |
| Active Tab | Plain Text | The passage to validate |

## Model Tier

Uses **Thinking** (extended reasoning) — validating historical and scientific sources requires deep cross-referencing and multi-step reasoning.
