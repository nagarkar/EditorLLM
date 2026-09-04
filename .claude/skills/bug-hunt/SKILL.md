# Autonomous Bug Hunt

You are an autonomous bug fixer. Iterate until the bug is fixed or you have exhausted 5 hypotheses.

## Input

$ARGUMENTS

This should be a plain-English description of the bug. Example:
```
directive playback positioning is off by one paragraph when the directive follows a deleted named range
```

If no bug description was provided, stop and ask: "What bug should I hunt?"

## Step 0 — Resume check (always run first)

Check whether `BUG_HYPOTHESES.md` exists in the project root.

- **Exists:** read it in full. Find the last hypothesis number and its outcome. If it is marked failed, resume from hypothesis N+1. Announce which hypothesis you are resuming from and what the prior attempts tried.
- **Does not exist:** create it now with a header line and start at hypothesis 1.

## Loop (repeat until fixed or 5 hypotheses exhausted)

**Step 1 — Repro test** (first run only)
Write a failing test in `src/__tests__/` that directly exercises the described failure. Do not modify this test in later iterations — it is the ground truth.

**Step 2 — Hypothesis**
Append to `BUG_HYPOTHESES.md`:
```
## Hypothesis N — <one-line theory>
**Evidence:** <files:lines that support this>
**Prediction:** <what fixing this would change>
**Outcome:** PENDING
```

**Step 3 — Fix**
Implement the minimal change. Do not refactor surrounding code.

**Step 4 — Verify**
Run `npm test`. Update the **Outcome** line in `BUG_HYPOTHESES.md`.
- Green → run `npm run lint`. If lint clean, write a `## Resolution` section to `BUG_HYPOTHESES.md` and report success.
- Red → log what you learned under the current hypothesis and return to Step 2.

**Step 5 — Exhausted**
After 5 failed hypotheses, write a `## Dead Ends` summary to `BUG_HYPOTHESES.md` and report to the user.

## Rules

- Use `TodoWrite` to track the current iteration step.
- Do not ask clarifying questions — infer from the codebase.
- Prefer the narrowest fix; if a hypothesis requires touching 3+ files, note it and try a simpler one first.
- Every write to `BUG_HYPOTHESES.md` must persist — it is the handoff document for the next session.
