// Jest configuration for src/__tests__/experimental/ only.
// Run with: npm run test:experimental
// NOT included in npm run test (the deploy-time gate).
module.exports = {
  rootDir: '../../',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/__tests__/experimental'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js'],
  setupFilesAfterEnv: ['<rootDir>/config/jest/jest.setup.js'],
  transformIgnorePatterns: ['/node_modules/'],
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/config/jest/tsconfig.test.json',
    },
  },
};
