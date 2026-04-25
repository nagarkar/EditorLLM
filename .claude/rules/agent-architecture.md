---
paths:
  - "**/src/**/*.ts"
  - "**/src/experimental/**/*.ts"
---

# EditorLLM Agent Architecture Rules

These rules govern the agent layer: BaseAgent subclasses, AgentInterpreter,
shared helper utilities, and the conventions that keep the GAS build and the
experimental/test layer in sync.

---

## 1. agentHelpers.ts — The Shared Utility Layer

`src/agentHelpers.ts` is the single source of truth for pure helper functions
shared between the GAS flat scope (BaseAgent subclasses) and the experimental
layer (AgentInterpreter, Jest tests).

**Belongs in agentHelpers.ts:**
- `buildStandardPrompt` — prompt assembly from section map + instructions
- `assertStyleProfileValid` — style profile guard
- `extractMarkdownFromJsonWrapper` — LLM output normalisation
- `validateOps` — operation array validation
- `instructionUpdateSchema`, `annotationOperationsSchema`, `threadRepliesSchema` — Gemini schema objects

**The litmus test:** Can the function run in Node.js with no GAS globals?
If yes → `agentHelpers.ts`. If it calls any GAS API or `Tracer.*` → it stays in
BaseAgent or the IIFE that owns it.

**Pattern:** Use `export function` in `agentHelpers.ts` so Jest can import the
functions as ES modules while the GAS build sees them as flat-scope globals
(fixgas.js strips the `Object.defineProperty(exports,…)` calls).

**Ambient declarations:** Every `export function` in `agentHelpers.ts` must
have a corresponding `declare function` in `src/Types.ts` so that GAS
flat-scope callers type-check correctly.

---

## 2. No Tracer Calls Inside Pure Helpers

Functions in `agentHelpers.ts` must **never** call `Tracer.*`.

- `validateOps` silently drops invalid operations and returns the valid subset.
- `BaseAgent.validateAndFilterOperations_` wraps `validateOps` and handles
  Tracer logging — that is the right place for observability.

Reason: `agentHelpers.ts` must be importable in Node.js (Jest) without a Tracer
mock. Keeping Tracer out of pure helpers avoids an entire category of test-setup
overhead and keeps concerns separated.

---

## 3. buildStandardPrompt — Use Real `\n`, Not `\\n`

When calling `buildStandardPrompt`, always pass instructions joined with a
real newline character (`'\n'`), not the escaped string `'\\n'`.

```typescript
// CORRECT
const prompt = buildStandardPrompt(sections, [
  'First instruction.',
  'Second instruction.',
].join('\n'));

// WRONG — produces literal backslash-n in the prompt
].join('\\n'));
```

`\\n` appears as the two-character sequence `\n` in the final prompt string,
which LLMs may interpret inconsistently. Use `'\n'` for all multi-line
instruction assembly.

---

## 4. findTextOrFallback_ — Never Silent Fallback

`CollaborationHelpers.findTextOrFallback_` (called by annotation operations)
must return **`null`** when the exact `match_text` is not found in the passage.
It must never fall back to an arbitrary location such as the first word of the
document or the first match of a partial string.

**Why:** A silent fallback causes annotations to appear on wrong text, which is
worse than skipping the operation. A missing `match_text` means the operation
should be skipped by `validateAndFilterOperations_`, not silently misfired.

Callers must check for `null` and skip the operation:
```typescript
const range = findTextOrFallback_(body, matchText);
if (!range) return;   // skip — match_text not found in this passage
```

---

## 5. extractMarkdownFromJsonWrapper — Lives in agentHelpers.ts

The function that strips a `\`\`\`json` code fence from an LLM response that
was supposed to return plain Markdown is a pure utility with no GAS dependency.
It lives in `src/agentHelpers.ts`, not as a private static on any agent class.

When `GeneralPurposeAgent.generateInstructions` (or any similar method) needs
to normalize an LLM markdown response, it calls `extractMarkdownFromJsonWrapper`
from `agentHelpers`, not a locally-defined copy.

---

## 6. Tab Name Naming Convention — Title Case with Spaces

All tab name constants in `Constants.TAB_NAMES` must use **Title Case with
spaces** matching the exact tab title as it appears in the Google Doc.

```typescript
// CORRECT
TETHER_INSTRUCTIONS: 'Tether Instructions',
GENERAL_PURPOSE_INSTRUCTIONS: 'General Purpose Instructions',

// WRONG — camelCase, PascalCase without spaces, or abbreviated names
TETHER_INSTRUCTIONS: 'TetherInstructions',
TETHER_INSTRUCTIONS: 'tether_instructions',
```

**Why:** Review tab assertions in parity tests compare against these constants.
A mismatch (e.g. `'TetherInstructions'` vs `'Tether Instructions'`) causes
silent instruction-update failures — the tab is not found and the update is
a no-op.

The parity tests' `review_tab` assertions will catch future mismatches
automatically if this convention is followed consistently.

---

## 7. BaseAgent Template Method Contract

`BaseAgent.handleCommentThreads` is the template method. Subclasses must
override exactly these protected methods — do not duplicate the orchestration
logic:

| Method | Purpose |
|--------|---------|
| `commentChunkSize_()` | Batch size for thread processing |
| `commentModelTier_()` | Model tier (FAST / THINKING) |
| `buildCommentPrompt_(chunk, passageContext)` | Prompt assembly for a batch |
| `commentSystemPrompt_()` | (Optional) Override system prompt per-call |

`generateInstructions()` and `annotateTab()` follow the same template pattern
via `super.generateInstructions()` guard — always call `super` first.

---

## 8. W1 `instruction_update` — preserve human edits

Regenerating an instruction tab (**W1** / `generateInstructions`) must treat the
**current tab contents** as potentially **author-edited** after the last model
run. The workflow exists so the author stays **in the loop** for instruction
quality; the model refines and extends, it does not assume a clean slate.

**Concrete agents (`generateInstructionPrompt` / `buildStandardPrompt`):**

- Always pass the existing instructions in a clearly named section (e.g.
  "Current … Instructions", "Current Style Profile") when the product flow
  includes that tab.
- The instruction lines (second argument to `buildStandardPrompt`) should tell
  the model to **merge** new manuscript-derived material with **preserved**
  substantive user edits, unless a stricter full-refresh behaviour is
  intentionally documented for that agent.

**Experimental `AgentDefinition`:**

- Mirror the same sections and **`instructions`** string as the concrete agent
  (parity). If the concrete prompt acknowledges current tab text, the
  declarative `instructions` must do the same — do not simplify away
  preservation language when syncing definitions.

Shared intent is also stated in **`Constants.SYSTEM_PREAMBLE`** (recursive
instruction loop).

---

## 9. Experimental Layer Isolation

`src/experimental/` is **excluded** from the main `tsconfig.json` and must
never appear in `dist/`. It compiles only under the experimental Jest tsconfig.

Rules:
- Do **not** create shared helpers in `src/experimental/` — they won't be
  available to the GAS build.
- Shared code used by both the experimental layer and GAS agents goes in
  `src/` (e.g. `src/agentHelpers.ts`).
- The experimental tsconfig must extend the main tsconfig and add
  `src/experimental/**/*` back into `include`.
- Any `.ts` file placed inside `src/experimental/` will never be pushed to
  GAS, even if you add it to `filePushOrder`.
