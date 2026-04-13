// Jest configuration for E2E 6 (missing API key) — SERIAL ONLY.
//
// E2E 6 modifies the global GAS ScriptProperties (clears GEMINI_API_KEY),
// which would silently break any concurrently-running Gemini-calling test.
// It therefore runs in its own serial Jest invocation, after the parallel
// batch completes.
//
// Run with: npm run test:e2e
// (the test:e2e script runs the parallel batch first, then this config)

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/integration/e2e.6.*.test.ts'],
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
  testTimeout: 5 * 60 * 1000,
  // Single worker — must not run alongside any other E2E test.
  maxWorkers: 1,
  forceExit: true,
  verbose: true,
  reporters: [
    'default',
    ['<rootDir>/jest.file-reporter.cjs', { outputFile: '.last_e2e_serial_test_results.txt' }],
  ],
};
