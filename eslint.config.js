// Flat ESLint config for the monorepo. Core packages must stay framework-free (shared with the
// Node backend): no React/Three/Zustand/Supabase imports and no browser globals.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'apps/web/public/**', 'asset-staging/**', 'test-output/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['**/*.{mjs,js}', 'apps/web/scripts/**', 'tools/**'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['packages/*/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['react', 'react-dom', 'react/*', 'three', 'three/*', '@react-three/*', 'zustand', 'zustand/*', '@supabase/*'], message: 'Core packages are framework-free (shared with the Node backend).' },
        ],
      }],
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'requestAnimationFrame'],
    },
  },
);
