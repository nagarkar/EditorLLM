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

1. The Auditor reads the current **StyleProfile**, your **existing** audit instructions, and a sample of the **MergedContent**.
2. It produces comprehensive audit rules: Chid Axioms, LaTeX caption requirements, unit systems, and a checklist.
3. The result is written directly to the **TechnicalAudit** tab, with the previous version backed up to **TechnicalAudit Scratch**.

This ensures your manual tweaks to the axiom checklist or LaTeX rules are maintained across generations.

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

| Workflow | Tab | Format | Why |
|---|---|---|---|
| **Generate (W1)** | StyleProfile | Markdown | Axiom framework definitions |
| **Generate (W1)** | TechnicalAudit | Markdown | Existing rules to be refined |
| **Generate (W1)** | MergedContent | Plain Text | Manuscript sample (first 6,000 chars) for axiom extraction |
| **Audit (W2)** | StyleProfile | Plain Text | Document's axiom framework |
| **Audit (W2)** | TechnicalAudit | Plain Text | Specific audit rules and checklists |
| **Audit (W2)** | Active Tab | Plain Text | The passage to audit |
| **Comments (W3)** | StyleProfile | Plain Text | Document's axiom framework |
| **Comments (W3)** | TechnicalAudit | Plain Text | Specific audit rules and checklists |
| **Comments (W3)** | Anchor Tab | Plain Text | Passage context for the audit |

## Model Tier

Uses **Thinking** (extended reasoning) — technical auditing requires step-by-step reasoning about axiom consistency and mathematical correctness.
