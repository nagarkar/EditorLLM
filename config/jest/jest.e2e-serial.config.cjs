// Jest configuration for E2E serial tests — runs after the parallel batch.
//
// Tests in this config run with maxWorkers:1 (one at a time) to avoid GAS
// resource contention. Two reasons a test ends up here:
//
//   e2e.6 — modifies global GAS ScriptProperties (clears GEMINI_API_KEY),
//            which would silently break any concurrently-running Gemini test.
//
//   e2e.7 — performs heavy Docs REST API calls (tab creation + EarTune
//            annotation). Running alongside e2e.3/e2e.5 (commentProcessorRun,
//            each ~35–40 s with Gemini) exhausts the GAS echo-URL window and
//            produces sign-in redirect responses instead of JSON.
//
// Run with: npm run test:e2e
// (the test:e2e script runs the parallel batch first, then this config)

module.exports = {
  rootDir: '../../',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/__tests__/integration/e2e.6.*.test.ts',
    '**/__tests__/integration/e2e.7.*.test.ts',
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
  testTimeout: 5 * 60 * 1000,
  // Single worker — must not run alongside any other E2E test.
  maxWorkers: 1,
  forceExit: true,
  verbose: true,
  reporters: [
    'default',
    ['<rootDir>/config/jest/jest.file-reporter.cjs', { outputFile: '.last_e2e_serial_test_results.txt' }],
  ],
};
