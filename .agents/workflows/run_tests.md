---
description: How to run and review tests (e2e and integration)
---

# Running Tests

When running end-to-end (E2E) or integration tests, follow this workflow:

1. Execute the test command (e.g. `npm run test:e2e` or `npm run test:integration`).
2. After the command completes, **always** read the corresponding Jest file-reporter output (gitignored; latest local run only):
   - E2E: `.last_e2e_test_results` (from `jest.e2e.config.cjs` → `jest.file-reporter.cjs`)
   - Integration: `.last_integration_test_results` (from `jest.integration.config.cjs`)
3. **Summarize** the outcome for the user: pass/fail counts, total time, per-test durations when present, and failure messages or stack traces worth acting on. Standard terminal output may be truncated or miss detail that appears in these files.

**Single source of truth:** This file lives under `.agents/workflows/`. The Cursor rule `.cursor/rules/e2e-test-results.mdc` only adds rule frontmatter and includes this document so instructions are not duplicated.
