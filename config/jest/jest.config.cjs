module.exports = {
  rootDir: '../../',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  // Exclude integration tests — run those separately via config/jest/jest.integration.config.cjs
  testPathIgnorePatterns: ['/node_modules/', '/__tests__/integration/'],
  moduleFileExtensions: ['ts', 'js'],
  setupFilesAfterEnv: ['<rootDir>/config/jest/jest.setup.js'],
  transformIgnorePatterns: ['/node_modules/'],
  globals: {
    'ts-jest': {
      // Use a test-specific tsconfig that sets module:commonjs so ts-jest can
      // resolve `export` statements in CollaborationHelpers.ts and other shared
      // helper modules. The main build still uses module:none for GAS flat scope.
      tsconfig: '<rootDir>/config/jest/tsconfig.test.json',
    },
  },
};
