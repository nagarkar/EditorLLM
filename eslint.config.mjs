// eslint.config.mjs — Flat config for TypeScript/Google Apps Script projects.
// Rules are tuned for the GAS environment: no modules, global scope, no strict.

import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.ts'],
    ignores: ['src/__tests__/**/*.ts', 'src/experimental/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2019,
        sourceType: 'script', // GAS: no ES modules
      },
      globals: {
        // GAS built-ins used across the project
        DocumentApp: 'readonly',
        SpreadsheetApp: 'readonly',
        HtmlService: 'readonly',
        PropertiesService: 'readonly',
        UrlFetchApp: 'readonly',
        ScriptApp: 'readonly',
        Drive: 'readonly',
        Logger: 'readonly',
        Utilities: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // ── Errors (break the build) ─────────────────────────
      'no-undef': 'error',               // catch typos in GAS globals
      'no-unused-vars': 'off',           // handled by TS compiler
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',

      // ── GAS-specific: no module syntax ───────────────────
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportDeclaration',
          message: 'GAS uses a flat global scope — import statements are not allowed.',
        },
        {
          selector: 'ExportNamedDeclaration',
          message: 'GAS uses a flat global scope — export statements are not allowed.',
        },
        {
          selector: 'ExportDefaultDeclaration',
          message: 'GAS uses a flat global scope — export statements are not allowed.',
        },
      ],

      // ── Warnings (noted but do not break build) ──────────
      'no-console': 'warn',              // use Logger.log in GAS instead
      'eqeqeq': ['warn', 'always'],
      'no-var': 'warn',                  // prefer const/let
    },
  },
  {
    // Experimental files: TypeScript modules (import/export intentional).
    // These compile to dist/experimental/ which is dead code in GAS — the
    // no-restricted-syntax import/export rule does not apply here.
    files: ['src/experimental/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2019, sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-unreachable': 'error',
    },
  },
  {
    // Test files: relax GAS globals rule, allow console
    files: ['src/__tests__/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2019, sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-unreachable': 'error',
    },
  },
];
