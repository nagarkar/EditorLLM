// Jest configuration for integration tests.
// Run with: npm run test:integration
//
// Integration tests make real Gemini API calls via xmlhttprequest.
// Requires: GEMINI_API_KEY environment variable.
// Optional: GOOGLE_DOC_ID, GOOGLE_TOKEN for Drive/Docs REST tests.
//
// Separated from the unit test config (jest.config.cjs) to keep
// `npm test` fast and network-free.

module.exports = {
  rootDir: '../../',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/integration/**/*.test.ts'],
  // Exclude all E2E tests — they require a clasp push to have happened first.
  // Run them separately with: npm run test:e2e
  // Matches e2e.test.ts (old monolith) AND all numbered variants
  // (e2e.2.smoke, e2e.3.skip-routing, e2e.5, e2e.6, e2e.7, e2e.8, …).
  // e2e.6 is serial-only (it clears GAS ScriptProperties) and must never
  // run in parallel with other agent tests — this exclusion enforces that.
  testPathIgnorePatterns: ['/node_modules/', '/integration/e2e\\.'],
  moduleFileExtensions: ['ts', 'js'],
  setupFilesAfterEnv: ['<rootDir>/config/jest/jest.integration.setup.js'],
  // Allow integration tests to import from helpers using ES module syntax.
  // This overrides module:"none" from tsconfig.json for test files only.
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
  // API calls can take up to 60 s for fast-tier models.
  // Individual tests that use the thinking model override to 120 s.
  testTimeout: 60000,
  // xmlhttprequest keeps an internal libuv handle open after synchronous XHR
  // completes. forceExit cleans up after all tests finish rather than hanging.
  forceExit: true,
  // Write a human-readable summary to .last_integration_test_results.txt after every run
  // so the AI assistant can read failures directly without copy-paste.
  reporters: [
    'default',
    ['<rootDir>/config/jest/jest.file-reporter.cjs', { outputFile: '.last_integration_test_results.txt' }],
  ],
};
