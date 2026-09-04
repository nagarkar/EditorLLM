# Multi-Path Feature Implementation

You are a coordinator agent. Your job is to implement a feature consistently
across every parallel code path in one pass — no sequential discovery, no
missed siblings.

## Input

$ARGUMENTS

Parse the input for these fields (flexible format — key=value, labeled lines, or free prose):
- **feature**: What to implement (required)
- **paths**: Pipe- or comma-separated list of code paths / call sites (required)
- **contract**: The shared interface, type, or behavioral constraint each path must satisfy (optional — infer from the feature if omitted)
- **test**: Whether to run tests after implementation (default: yes)

Example of well-formed input (do not treat these as real paths — they are format illustrations only):
```
feature="add request tracing" paths="handlerA | handlerB | handlerC" contract="attach traceId to every outbound call"
```

If any required field is missing, ask for it before proceeding.

## Protocol

### Step 1 — Enumerate and confirm
List each path you identified from the input. For each, state:
- File(s) to change
- Exact function / code region
- How the contract applies to that path

Do not start implementing until the enumeration is complete.

### Step 2 — Implement in parallel
Spawn one sub-agent per path using the Task tool. Each sub-agent must:
1. Read the current implementation of its assigned path
2. Apply the feature according to the shared contract
3. Ensure every terminal branch (success, error, early return) is covered — no partial coverage
4. Note which lines were changed

Dispatch all sub-agents simultaneously. Do not wait for one before starting another.

### Step 3 — Merge and verify
After all sub-agents complete:
1. Run `npm run build` — must exit 0
2. Run `npm test` — report pass count
3. Run `npm run lint` — must exit 0

### Step 4 — Parity summary
Produce a table:

| Path | File | Changed? | Notes |
|------|------|----------|-------|
| … | … | ✅ / ❌ | … |

Every path must show ✅. If any show ❌, fix before declaring done.

## Rules
- Never declare complete while any path is missing the feature
- Never declare complete while build, tests, or lint are failing
- If a path genuinely does not need the change (e.g., it delegates to another path that was already updated), say so explicitly in the Notes column — do not silently skip it
