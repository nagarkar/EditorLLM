// Jest configuration for E2E tests only.
// Run with: npm run test:e2e
//
// How E2E tests work
// ------------------
// Apps Script's Execution API (scripts.run) does NOT support container-bound
// scripts (EditorLLMTest is bound to a Google Doc). Instead, E2E tests POST to
// a doPost() web app endpoint deployed from the same script.
//
// The web app URL is stored in .clasp.json as "webAppUrl". If it is empty,
// the test suite is skipped automatically (no failure).
//
// One-time setup:
//   1. clasp push
//   2. Apps Script editor → Deploy → New deployment → Type: Web app
//        Execute as: Me | Who has access: Anyone with Google account
//        Project version: Latest  (picks up every clasp push automatically)
//   3. Copy the /exec URL to .clasp.json as "webAppUrl"
//   NOTE: Never run `clasp deploy -i <webAppUrl>` — clasp defaults to
//         API Executable and will break the /exec URL.
//
// After setup, only `clasp push` is needed before each test run.
//
// Requires: GEMINI_API_KEY, GOOGLE_DOC_ID, GOOGLE_TOKEN (auto-fetched via gcloud),
//           webAppUrl (in .clasp.json)

module.exports = {
  rootDir: '../../',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  // Matches e2e.2-e2e.5 parallel tests. Excluded from this config:
  //   e2e.6 — modifies global GAS ScriptProperties (GEMINI_API_KEY); must not
  //            overlap with any Gemini-calling test.
  //   e2e.7 — heavy tab-creation + EarTune annotation; concurrent GAS Docs API
  //            calls from e2e.3/e2e.5 (commentProcessorRun) can exhaust the
  //            echo-URL window, causing a sign-in redirect. Runs serially.
  // The legacy e2e.test.ts is excluded here too — it still works standalone
  // but is superseded by these numbered files.
  testMatch: [
    '**/__tests__/integration/e2e.[12345].*.test.ts',
  ],
  testPathIgnorePatterns: ['/node_modules/'],
  moduleFileExtensions: ['ts', 'js'],
  setupFilesAfterEnv: ['<rootDir>/config/jest/jest.integration.setup.js'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs',
        esModuleInterop: true,
        strict: false,
      },
    }],
  },
  transformIgnorePatterns: ['/node_modules/'],
  // Each file runs as a separate worker. Allow up to 10 minutes per test
  // (thinking-tier agents + GAS boot overhead).
  testTimeout: 10 * 60 * 1000,
  // Run up to 4 test files in parallel. Each file gets its own worker so
  // GAS executions overlap. E2E 5 (multi-thread, slowest ~150 s) now runs
  // concurrently with the other suites rather than waiting behind them.
  maxWorkers: 4,
  forceExit: true,
  // Force verbose test-name output even when stdout is piped (e.g. | tee).
  verbose: true,
  // Write a human-readable summary to .last_e2e_test_results after every run.
  reporters: [
    'default',
    ['<rootDir>/config/jest/jest.file-reporter.cjs', { outputFile: '.last_e2e_test_results.txt' }],
  ],
};
