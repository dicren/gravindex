// Shared ESLint flat config (eslint 10). `.eslintrc.*` is the legacy format and
// is no longer supported.
//
// ⚠️ `.mjs` and not `.ts` on purpose: eslint only reads a TypeScript config if
// it finds `jiti`, and there is nothing to gain in types here.
//
// Two exports, and the difference matters:
//
//   `base`     the shared rules, meant to be SPREAD by each package:
//                  import { base } from '../../eslint.config.mjs'
//                  export default tseslint.config(...base, /* package stuff */)
//              It carries no repo-layout paths, so spreading it can never make
//              a package ignore itself.
//   `default`  what runs when you lint from the repo root — `base` plus an
//              ignore for `packages/**`, which each package lints on its own.
//
// ⚠️ The base is deliberately NOT type-aware (`recommended`, not
// `recommendedTypeChecked`): pointing `parserOptions` at a `tsconfig.json` only
// works from the package that owns it. Packages that want type-aware rules add
// `languageOptions.parserOptions.projectService` themselves.
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';

export const base = tseslint.config(
  {
    // Universal only — build output and installed dependencies. Anything
    // package-specific (generated API clients, e2e artifacts) belongs in that
    // package's own config.
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'],
  },

  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  {
    // Plain JS/MJS at the top of a package is always tooling — eslint, vite,
    // jest and mikro-orm config files — so it runs in Node.
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  {
    rules: {
      // Nest controllers and Vue composables are read by their signature, not
      // by an annotation repeated on every method.
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',

      // ⚠️ `any` is banned repo-wide, not just in the frontend. The escape
      // hatch that lets a typed codebase call itself TypeScript is closed on
      // purpose. Where it is genuinely unavoidable, disable it inline WITH a
      // comment saying why.
      '@typescript-eslint/no-explicit-any': 'error',

      // The base rule double-reports on TS constructs (enums, overloads).
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  // Last: turns off every stylistic rule that would fight the formatter, and
  // reports Prettier's own diff as a lint error. Config lives in `.prettierrc`.
  prettierRecommended,
);

export default tseslint.config(...base, {
  // Each package lints itself (`npm run lint` at the root fans out through
  // the workspaces). From here we only cover the root's own config files.
  ignores: ['packages/**'],
});
