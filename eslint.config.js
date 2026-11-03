import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Self-contained lint config for the companion. Root `eslint .` ignores
// `packages/**`, so this runs as `eslint .` from the package directory and
// reuses the repo-installed plugins.
export default defineConfig([
  // `dist` is generated; `consumer-check/app` is a throwaway consumer app built
  // against the packed tarballs by consumer-check/run.mjs, not library source.
  globalIgnores(['dist', 'consumer-check/app/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
    },
  },
])
