// The one place the running app states its own version.
//
// ⚠️ Deliberately a literal and not an import of `package.json`: with
// `outDir: dist` and `resolveJsonModule`, importing a file above `src/` moves
// the inferred rootDir to the package root and the whole build lands in
// `dist/src/`. Keep this in lockstep with `package.json`'s `version`.
export const APP_VERSION = '2.0.2';
