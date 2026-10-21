// Package-level flat config. The shared rules (including the repo-wide ban on
// `any`) live at the root and are SPREAD here — see the long comment in
// `../../eslint.config.mjs` for why `base` and `default` are two exports.
import tseslint from 'typescript-eslint';
import globals from 'globals';
import { base } from '../../eslint.config.mjs';

export default tseslint.config(...base, {
  files: ['**/*.ts'],
  languageOptions: {
    globals: { ...globals.node, ...globals.jest },
  },
});
