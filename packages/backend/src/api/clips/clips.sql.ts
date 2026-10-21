import { limitOf, offsetOf } from '../../common/dto/pagination-query.dto';
import { dedupe } from '../../common/validation/to-string-array';
import { ClipOrder, ClipsQueryDto, DEFAULT_CLIP_ORDER } from './dto/clips-query.dto';

// Everything the clips list query is made of, as pure functions over plain
// values: no EntityManager, no connection, no database. That is what lets the
// order whitelist and the filter builder be tested by a suite that runs in
// milliseconds, and it is why this file exists separately from the service.

export interface SqlFragment {
  sql: string;
  /** Positional `?` bindings, in the order the placeholders appear in `sql`. */
  params: unknown[];
}

// ⚠️ The ONLY place an `order` value becomes SQL. The map's VALUES are written
// here, in this file; the client's string is never a fragment, only a key.
// Passing the raw parameter to `addOrderBy` would be a GET-reachable injection
// point, because SQL does not parameterise an ORDER BY fragment.
const ORDER_COLUMNS: Readonly<Record<ClipOrder, string>> = {
  points: 'ord_points',
  'clip.createdAt': 'ord_created_at',
  'episode.date': 'ord_episode_date',
};

// Two layers, deliberately, and they answer differently:
//
//   - the DTO's `@IsIn(CLIP_ORDER_VALUES)` makes an unknown value a **400**, so
//     a typo is loud instead of silently reordering someone's library;
//   - this function, which the request never reaches unvalidated, still FALLS
//     BACK to the default rather than interpolating. If the pipe is ever
//     bypassed (a direct service call, a future internal caller), the worst
//     case is the wrong sort order, not arbitrary SQL.
export function resolveOrderColumn(order?: string): string {
  const column =
    order !== undefined && Object.prototype.hasOwnProperty.call(ORDER_COLUMNS, order)
      ? ORDER_COLUMNS[order as ClipOrder]
      : undefined;

  return column ?? ORDER_COLUMNS[DEFAULT_CLIP_ORDER];
}

// The tag filter arrives under `tags` or under the axios-shaped `tags[]`; both
// are accepted and merged. See `to-string-array.ts` for why there are two.
export function resolveRequestedTags(query: ClipsQueryDto): string[] {
  return dedupe([...(query.tags ?? []), ...(query['tags[]'] ?? [])]);
}

export interface ClipFilterOptions {
  search?: string;
  tags: readonly string[];
}

// `search` matched against the two titles, as it appears in both the search
// filter and — see `buildClipFilters` — inside the tag filter. Two `?`.
const TITLE_MATCHES_SEARCH = `unaccent(c."title") ilike unaccent(?) or unaccent(e."title") ilike unaccent(?)`;

// The WHERE clause of the list query, over the aliases `c` (clip) and `e`
// (episode).
export function buildClipFilters(options: ClipFilterOptions): SqlFragment {
  const conditions: string[] = [];
  const params: unknown[] = [];

  // An empty string is treated as absent, so `?search=` filters nothing.
  const pattern =
    options.search !== undefined && options.search !== '' ? `%${options.search}%` : undefined;

  // ⚠️ Accent- AND case-insensitive, matching the clip title, its episode's
  // title and its tags. The columns are binary (case- and accent-SENSITIVE), so
  // `unaccent()` on both sides plus ILIKE does the job: `cancion` finds
  // `canción` and `canción` finds `cancion`.
  //
  // No index can serve this (`%term%` has a leading wildcard) and none is
  // wanted: 395 episodes and 180 clips make the sequential scan invisible.
  // Wildcards inside `search` still behave as wildcards.
  if (pattern !== undefined) {
    conditions.push(
      `(${TITLE_MATCHES_SEARCH}` +
        ` or exists (select 1 from "tag" ts` +
        ` where ts."clip_id" = c."id" and unaccent(ts."tag") ilike unaccent(?)))`,
    );

    params.push(pattern, pattern, pattern);
  }

  // ⚠️ AND, not OR: a clip must carry EVERY requested tag. Counting the distinct
  // matches in a correlated subquery, rather than a HAVING over a GROUP BY, needs
  // no GROUP BY at all, so the total comes from the same query as the rows.
  //
  // Exact match, case- and accent-sensitive: the tag list the UI offers comes
  // from `GET /tags`, so there is nothing to be lenient about.
  //
  // ─────────────────────────────────────────────────────────────────────────
  // ⚠️ AND NOW THE PART THAT LOOKS LIKE A BUG AND IS NOT A MISTAKE.
  //
  // `search` and `tags[]` are NOT independent. When both are present, the tag
  // filter only sees the tags that the SEARCH already matched — unless the
  // search matched one of the two titles, in which case it sees all of them.
  // That is `and (${TITLE_MATCHES_SEARCH} or unaccent(tf."tag") ilike …)`
  // below, and it is the specified behaviour, not an accident of this one.
  //
  // Why it behaves this way: `search` also filters the joined tag rows, so a
  // clip whose titles did not match keeps only the tag rows that matched the
  // search itself; every other tag is discarded before the tag filter counts it.
  //
  // The pinned answers:
  //   ?search=cine&tags[]=Monográficos      →  6 clips (all 6 match "cine" in
  //                                            the clip title). Treating the
  //                                            two filters as independent
  //                                            returns 14.
  //   ?search=arturo&tags[]=Anécdotas       →  8, not 13.
  //   ?search=llamada&tags[]=Cine           →  0, not 6.
  // Search-only and tags-only queries are untouched by this — the extra clause
  // is only emitted when both are present.
  //
  // ⚠️ It is reachable from the real UI (the library has the search box and the
  // tag filter side by side), so it is the specification. Making the two filters
  // independent — which is almost certainly what a user expects — is a **product
  // decision**, not a cleanup: take it consciously, and update the tests that pin
  // this behaviour in the same change.
  // ─────────────────────────────────────────────────────────────────────────
  const tags = dedupe(options.tags);
  if (tags.length > 0) {
    const placeholders = tags.map(() => '?').join(', ');
    const survivedSearch =
      pattern === undefined
        ? ''
        : ` and (${TITLE_MATCHES_SEARCH} or unaccent(tf."tag") ilike unaccent(?))`;

    conditions.push(
      `(select count(distinct tf."tag") from "tag" tf` +
        ` where tf."clip_id" = c."id" and tf."tag" in (${placeholders})${survivedSearch}) = ?`,
    );
    params.push(...tags);
    if (pattern !== undefined) {
      params.push(pattern, pattern, pattern);
    }
    params.push(tags.length);
  }

  return { sql: conditions.length > 0 ? conditions.join(' and ') : 'true', params };
}

// The payload every clip row carries, spelled ONCE so `GET /clips` and
// `GET /clips/:id/related` cannot drift apart on what a row looks like. It
// assumes the aliases `c` (clip), `e` (episode), `agg` (the vote aggregate) and
// `tg` (the tag array); the two joins that produce the last two are below.
const CLIP_PAYLOAD_COLUMNS = `
      c."title" as "title",
      c."start" as "start",
      c."end" as "end",
      e."id" as "episode_id",
      e."title" as "episode_title",
      e."cover" as "episode_cover",
      e."file" as "episode_file",
      e."original_url" as "episode_original_url",
      -- ⚠️ Rendered to an ISO-8601 string in SQL, not handed over as a Date:
      -- MikroORM installs its own pg type parser for timestamptz, so a raw
      -- query gets the driver's string back and \`.toISOString()\` would throw.
      -- This format is byte-identical to what \`Date.toISOString()\` produces,
      -- which is what \`GET /clips/:id\` emits through the entity.
      to_char(e."date" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "episode_date",
      coalesce(agg."up", 0)::int as "up",
      coalesce(agg."up", 0)::int as "points",
      coalesce(tg."tags", '{}'::text[]) as "tags"`;

// ⚠️ ONE aggregate for three numbers. Every row in `vote` is a +1
// (`dto/clip-params.dto.ts`), so `up`, `points` and `count(*)` are the same
// number — and `points` is emitted FROM `up` above
// rather than computed separately, so the sort key cannot disagree with the
// number printed beside it. `sum`, not `count`, so a stray value that should not
// exist would still be visible rather than silently counted as one.
const VOTE_AGGREGATE_JOIN = `
    left join lateral (
      select sum(vv."value") as "up"
      from "vote" vv where vv."clip_id" = c."id"
    ) agg on true`;

const TAG_ARRAY_JOIN = `
    left join lateral (
      select array_agg(tt."tag" order by tt."tag") as "tags"
      from "tag" tt where tt."clip_id" = c."id"
    ) tg on true`;

// One round trip. Rows, their vote aggregates, their episode, their tags and
// the unpaginated total, all of it.
//
// The shape is three CTEs:
//
//   base    the filtered clip ids plus the three sort keys. Only what the
//           filters and the ordering need — the payload joins come later, so
//           they run for one page's worth of rows, not for the whole match set.
//   total   `count(*)` over `base`.
//   page    `base`, ordered and sliced.
//
// ⚠️ `total` is LEFT JOINED to `page`, not the other way round, and that is the
// point: `total` always has exactly one row, so a page past the end of the
// result set still returns the correct total with zero clips. `count(*) over ()`
// alongside the rows would have returned nothing at all in that case — and
// `?page=999` returning `total: 180` with an empty `results` is behaviour the
// frontend depends on (it divides `total` by `limit` to find the last page,
// which is how it recovers after a filter is cleared).
//
// ⚠️ It still matters with infinite scroll: the counter over the list ("180
// cortes") is this `total` under the current filter, never "N of M loaded".
export function buildClipListQuery(query: ClipsQueryDto): SqlFragment {
  const filters = buildClipFilters({ search: query.search, tags: resolveRequestedTags(query) });
  const orderColumn = resolveOrderColumn(query.order);

  const sql = `
    with "base" as (
      select
        c."id" as "id",
        coalesce(v."points", 0) as "ord_points",
        c."created_at" as "ord_created_at",
        e."date" as "ord_episode_date"
      from "clip" c
      inner join "episode" e on e."id" = c."episode_id"
      left join lateral (
        select sum(vv."value") as "points" from "vote" vv where vv."clip_id" = c."id"
      ) v on true
      where ${filters.sql}
    ),
    "total" as (select count(*)::int as "total" from "base"),
    "page" as (
      select * from "base" order by "${orderColumn}" desc, "id" desc limit ? offset ?
    )
    select
      t."total" as "total",
      p."id" as "id",${CLIP_PAYLOAD_COLUMNS}
    from "total" t
    left join "page" p on true
    left join "clip" c on c."id" = p."id"
    left join "episode" e on e."id" = c."episode_id"${VOTE_AGGREGATE_JOIN}${TAG_ARRAY_JOIN}
    order by p."${orderColumn}" desc, p."id" desc
  `;

  return { sql, params: [...filters.params, limitOf(query), offsetOf(query)] };
}

/** How many related clips `GET /clips/:id/related` returns at most. */
export const RELATED_CLIPS_LIMIT = 6;

// `GET /clips/:id/related` — the "Relacionados · comparten tag" strip on the
// clip permalink.
//
// ⚠️ A real endpoint rather than `GET /clips?tags[]=…` from the browser, and
// the reason is the ORDER, not the fetch. Most clips carry a single tag, so
// filtering by it client-side returns whatever the default sort produces and
// calls it "related". Here the first sort key is **how many tags the two clips
// share**, which is the only thing on this screen that means relatedness at
// all; `up` and then the id break the ties.
//
// The self-join is on the tag STRING because a tag is the `(clip, tag)` pair and
// there is no tag table to join through. `t2."clip_id" <> ?` excludes the clip
// itself — it shares every one of its own tags and would otherwise always be
// first.
//
// ⚠️ Tags are matched EXACTLY, and the existing ones all begin with a space
// (` Canciones`). Nothing here trims: the join compares stored values against
// stored values, so the quirk is invisible to it, and trimming would match
// nothing at all.
//
// A clip with no tags produces an empty `shared` CTE and therefore no rows,
// which is what the view needs to decide not to render the section.
export function buildRelatedClipsQuery(clipId: number, limit = RELATED_CLIPS_LIMIT): SqlFragment {
  const sql = `
    with "shared" as (
      select t2."clip_id" as "id", count(distinct t2."tag")::int as "shared"
      from "tag" t1
      inner join "tag" t2 on t2."tag" = t1."tag" and t2."clip_id" <> t1."clip_id"
      where t1."clip_id" = ?
      group by t2."clip_id"
    )
    select
      c."id" as "id",${CLIP_PAYLOAD_COLUMNS}
    from "shared" s
    inner join "clip" c on c."id" = s."id"
    inner join "episode" e on e."id" = c."episode_id"${VOTE_AGGREGATE_JOIN}${TAG_ARRAY_JOIN}
    order by s."shared" desc, coalesce(agg."up", 0) desc, c."id" desc
    limit ?
  `;

  return { sql, params: [clipId, limit] };
}

// The clip half of a row: what both queries above select besides their own
// bookkeeping columns.
export interface ClipPayloadRow {
  id: number;
  title: string;
  start: number;
  end: number;
  episode_id: number;
  episode_title: string;
  episode_cover: string;
  episode_file: string;
  episode_original_url: string;
  episode_date: string;
  up: number;
  /** ⚠️ Always equal to `up`. It exists because `order=points` is in shared links. */
  points: number;
  tags: string[];
}

// One row of `buildClipListQuery`. Every clip column is nullable because of the
// `total`-always-wins left join: when the requested page is empty the query
// still returns a single row carrying nothing but the total.
export type ClipListRow = { total: number } & {
  [K in keyof ClipPayloadRow]: K extends 'up' | 'points' | 'tags'
    ? ClipPayloadRow[K]
    : ClipPayloadRow[K] | null;
};

// A row that actually carries a clip, as opposed to the total-only row the
// query returns when the requested page is past the end of the result set.
export type PopulatedClipListRow = ClipListRow & ClipPayloadRow;

export function isPopulatedRow(row: ClipListRow): row is PopulatedClipListRow {
  return row.id !== null;
}
