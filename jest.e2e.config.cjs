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
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/integration/e2e.test.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  moduleFileExtensions: ['ts', 'js'],
  setupFilesAfterEnv: ['<rootDir>/jest.integration.setup.js'],
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
  // E2E involves a real GAS execution + Gemini API call — allow 5 minutes.
  testTimeout: 5 * 60 * 1000,
  forceExit: true,
};
