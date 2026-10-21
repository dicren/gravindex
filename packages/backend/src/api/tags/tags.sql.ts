// The whole of `GET /tags`, as a value rather than a string built inside the
// service, so the ordering rule below can be asserted without a database.

// ⚠️ `collate "C"` is code-point order, and it is **load bearing**.
//
// The 102 existing tags come back in code-point order: every capitalised tag
// before every lowercase one (`Zombies` … then `after nigth`, `atraco`,
// `chups`), `LLamadas` before `Labrador labrador no es`, `Muñequetes` after
// `Mulata`, `Anécdotas` after `Andy Warhol`.
//
// A bare `order by "tag"` uses the DATABASE's collation instead, and this
// project's postgres is created with `en_US.utf8`. Under glibc — or any ICU
// collation — that is a linguistic sort: `after nigth` first, `Labrador` before
// `LLamadas`, accents folded onto their base letter. Measured, not guessed:
// `order by tag collate "en-US-x-icu"` on the real tag list produces exactly
// that. The alpine image happens to agree with `C` today only because musl
// ships no locale data, so leaving it implicit means the order silently changes
// the day the image, the host or the `initdb` locale does.
//
// ⚠️ The collation is applied in the SELECT list and the sort is `order by 1`,
// not `order by "tag" collate "C"`: `"tag" collate "C"` is a different
// expression from the bare `"tag"`, and the grouping below has to be written
// against the same expression the SELECT list returns.
// `C` is a deterministic collation, so applying it to the grouping changes
// nothing about which values are considered equal — ` Cine` groups with ` Cine`
// either way.
//
// ⚠️ Each row carries its `count`, not just the tag: the library's tag filter
// lists all 102 tags ordered by use with their counts beside them, and counting
// client-side is not possible: the browser holds one page of clips, not the 382
// tag rows.
//
// The ORDER stays code-point even though the filter draws the list by count:
// the ordering is pinned by a test for the reason above, and re-sorting 102
// rows in the browser is free.
//
// ⚠️ `group by`, not `select distinct`: they answer the same question about the
// keys, but only one of them can also count. There is no tag table — a tag IS
// the `(clip, tag)` pair — so "every tag" really is a grouping over the join
// table, and a tag stops existing the moment its last clip loses it.
export const TAGS_QUERY = `select "tag" collate "C" as "tag", count(*)::int as "count" from "tag" group by 1 order by 1`;

export interface TagRow {
  tag: string;
  count: number;
}
