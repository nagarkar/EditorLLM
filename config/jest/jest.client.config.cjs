module.exports = {
  rootDir: '../../',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/client'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js'],
  setupFilesAfterEnv: ['<rootDir>/config/jest/jest.client.setup.js'],
  transformIgnorePatterns: ['/node_modules/'],
  // ffmpeg WASM loads in ~3 s; individual encode ops add a few seconds each.
  testTimeout: 60000,
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: '<rootDir>/config/jest/tsconfig.client.test.json',
    }],
  },
};
