/**
 * A tag is free text and nothing else — there is no tag table in the database,
 * a tag *is* the `(clip, tag)` pair (root `CLAUDE.md`, "Data model"). So the
 * domain type is genuinely a string, and giving it a name is the point: it
 * documents that `GET /tags` returns identities, not labels, and that matching
 * against `GET /clips?tags[]=…` is EXACT — case- and accent-sensitive.
 *
 * ⚠️ Do not "normalize" a tag anywhere in the app. Two tags differing only in
 * accents are two different tags to the backend, and the library's filter would
 * silently stop matching.
 */
export type Tag = string;

/**
 * A tag together with how many clips carry it — one row of `GET /tags`.
 *
 * ⚠️ **The endpoint answers `{ tag, count }`, not a flat `string[]`.** The
 * library's tag filter lists all 102 tags ordered by use with the count beside
 * each one, and the browser cannot
 * derive that: it holds one page of clips, not the 382 tag rows.
 *
 * ⚠️ The list arrives in **code-point order**, which is not the order the filter
 * draws. Re-sorting 102 rows by `count` in the delivery layer is free; changing
 * the endpoint's order is not — it is pinned by a test, because a different
 * Postgres locale reshuffles every accented tag.
 */
export interface TagCount {
  readonly tag: Tag;
  readonly count: number;
}
