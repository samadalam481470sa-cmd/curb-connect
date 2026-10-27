// One flat config for every workspace. Workspace `lint` scripts run `eslint .` from their own
// directory and ESLint resolves this file by walking up, so rules stay identical everywhere.
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/.next/',
    '**/coverage/',
    '**/.data/',
    '**/playwright-report/',
    '**/test-results/',
    '**/next-env.d.ts',
    // Superseded v1 app, kept for reference only (see legacy/README.md).
    'legacy/',
    // Python service is linted by its own tooling.
    'services/',
    'apps/api/drizzle/',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-restricted-syntax': [
        'error',
        {
          // Money must never be JS floating point (see docs/adr/0005). parseFloat on user input is
          // almost always a money/measurement bug; use decimal.js or the geometry unit parsers.
          selector: "CallExpression[callee.name='parseFloat']",
          message: 'Use decimal.js (money) or @fieldline/geometry parsers instead of parseFloat.',
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}', 'packages/pdf/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ['apps/web/public/sw.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.serviceworker },
    },
  },
);
