/**
 * Strip diacritics from a string, for **matching only**.
 *
 * Unicode normalisation does the job with no package at all: NFD splits `ñ` into
 * `n` + U+0303 and `é` into `e` + U+0301, and the combining marks are then
 * dropped.
 *
 * ⚠️ **Never store or send the folded form.** A tag IS its string — the backend
 * matches `GET /clips?tags=…` byte for byte, and 12 of the ~100 real tags carry
 * accents or an eñe (`Anécdotas`, `Briñate`). Folding is a *filter* over what to
 * offer the visitor; the value that leaves this app is always the original.
 * `core/domain/tags/tag.entity.ts` states the same rule from the other side.
 */
export function foldAccents(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

/** Fold and lower-case: the comparable form of a string. */
export function foldForSearch(text: string): string {
  return foldAccents(text.toLowerCase());
}
