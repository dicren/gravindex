import { limitOf, offsetOf } from '../../common/dto/pagination-query.dto';
import { EpisodesQueryDto } from './dto/episodes-query.dto';

// The episodes queries as pure functions over plain values: no EntityManager, no
// connection, no database. Same split as `clips.sql.ts`, and for the same
// reason — the filter builder and the parameter binding get a suite that runs in
// milliseconds.

export interface SqlFragment {
  sql: string;
  /** Positional `?` bindings, in the order the placeholders appear in `sql`. */
  params: unknown[];
}

// ⚠️ Both queries below render `date` to an ISO-8601 string in SQL rather than
// handing over a `Date`: MikroORM installs its own pg type parser for
// `timestamptz`, so a RAW query gets the driver's string back and
// `.toISOString()` would throw. Byte-identical to what `Date.toISOString()`
// produces, which is what the entity serialises to.
const ISO_DATE = `to_char(e."date" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// ⚠️ `collate "C"` is code-point order, which is what `/tags` and every rendered
// tag list use. The bare `order by` would use the DATABASE's collation, and this
// project's postgres is created with `en_US.utf8`: under glibc that sorts
// `after nigth` before `Andy Warhol` and `Labrador` before `LLamadas`. The
// alpine image happens to agree with `C` today because musl has no locale data
// — which is precisely why this must not be left implicit.
export const CODE_POINT_ORDER = 'collate "C"';

export interface EpisodeFilterOptions {
  search?: string;
  /** The `Solo con cortes · 61` toggle. `false` and absent mean the same thing. */
  withClips?: boolean;
}

// The WHERE clause of the list query, over the alias `e` (episode).
//
// ⚠️ **Title only.** `GET /clips` searches the clip title, the episode title AND
// the tags; this endpoint has only ever looked at `episode.title`, and the
// frontend's episode picker depends on that narrowness.
//
// Accent- and case-insensitive, as everywhere else: the columns are binary (case-
// and accent-SENSITIVE), so `unaccent()` on both sides plus ILIKE does the job:
// `desnudate` finds `Desnúdate` and back.
export function buildEpisodeFilters(options: EpisodeFilterOptions): SqlFragment {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.search !== undefined && options.search !== '') {
    conditions.push(`unaccent(e."title") ilike unaccent(?)`);
    params.push(`%${options.search}%`);
  }

  // ⚠️ `exists`, not `clip_count > 0` over the aggregate below: this clause
  // lands in the `base` CTE, which runs over all 395 rows, while the count runs
  // only for the page. Postgres stops at the first matching clip.
  if (options.withClips === true) {
    conditions.push(`exists (select 1 from "clip" cc where cc."episode_id" = e."id")`);
  }

  return { sql: conditions.length > 0 ? conditions.join(' and ') : 'true', params };
}

// One round trip: the page and the unpaginated total together.
//
// ⚠️ `total` is LEFT JOINED to `page`, not the other way round — `total` always
// has exactly one row, so `?page=999` still answers the real total with zero
// episodes. `count(*) over ()` alongside the rows would have returned nothing at
// all, and the frontend divides `total` by `limit` to find the last page.
// `/episodes?limit=1&page=999` answers `total: 395`.
//
// Ordering is `date` descending, tie-broken by descending id. ⚠️ The tiebreak is
// what keeps paging stable: no two of the 395 episodes share a date today, so it
// is unobservable in practice — it exists so that paging cannot drop or repeat a
// row if two ever do.
export function buildEpisodeListQuery(query: EpisodesQueryDto): SqlFragment {
  const filters = buildEpisodeFilters({ search: query.search, withClips: query.withClips });

  const sql = `
    with "base" as (
      select e."id" as "id", e."date" as "ord_date"
      from "episode" e
      where ${filters.sql}
    ),
    "total" as (select count(*)::int as "total" from "base"),
    "page" as (
      select * from "base" order by "ord_date" desc, "id" desc limit ? offset ?
    )
    select
      t."total" as "total",
      p."id" as "id",
      e."title" as "title",
      e."cover" as "cover",
      e."file" as "file",
      e."original_url" as "original_url",
      ${ISO_DATE} as "date",
      -- ⚠️ Counted for the PAGE, not for the whole match set: the join is below
      -- the \`page\` CTE, so this runs for the 24 rows being returned rather than
      -- for all 395. \`coalesce\` because an episode with no clips is the normal
      -- case here — 334 of the 395 have none.
      coalesce(cnt."clip_count", 0)::int as "clip_count"
    from "total" t
    left join "page" p on true
    left join "episode" e on e."id" = p."id"
    left join lateral (
      select count(*) as "clip_count" from "clip" cc where cc."episode_id" = e."id"
    ) cnt on true
    order by p."ord_date" desc, p."id" desc
  `;

  return { sql, params: [...filters.params, limitOf(query), offsetOf(query)] };
}

// The whole of `GET /episodes/:id` in ONE query: the episode, its clips, each
// clip's vote aggregates and each clip's tags.
//
// ⚠️ One round trip, where loading each clip's vote counts separately would take
// **2N + 1**: the episode with its clips and tags, then two counts per clip (22
// statements on the busiest episode). Two correlated lateral aggregates do the
// same work per row.
//
// The clip join is a LEFT join so an episode with no clips still yields one row
// — that row carries a null `clip_id` and the service drops it. Zero rows
// therefore means "no such episode", which is where the 404 comes from.
export function buildEpisodeDetailQuery(id: number): SqlFragment {
  const sql = `
    select
      e."id" as "id",
      e."title" as "title",
      e."cover" as "cover",
      e."file" as "file",
      e."original_url" as "original_url",
      ${ISO_DATE} as "date",
      c."id" as "clip_id",
      c."title" as "clip_title",
      c."start" as "clip_start",
      c."end" as "clip_end",
      coalesce(agg."up", 0)::int as "up",
      coalesce(tg."tags", '{}'::text[]) as "tags"
    from "episode" e
    left join "clip" c on c."episode_id" = e."id"
    -- ⚠️ The SAME expression \`clips.sql.ts\` uses, so the two endpoints cannot
    -- drift apart on what \`up\` means. \`value\` is constrained to +1 (enforced by
    -- \`VoteParamsDto\`), so the sum and the count of votes are the same number.
    left join lateral (
      select sum(vv."value") as "up"
      from "vote" vv where vv."clip_id" = c."id"
    ) agg on true
    left join lateral (
      select array_agg(tt."tag" order by tt."tag" ${CODE_POINT_ORDER}) as "tags"
      from "tag" tt where tt."clip_id" = c."id"
    ) tg on true
    where e."id" = ?
    -- Ascending clip id, made explicit so the order is not left to the planner.
    -- It is also chronological — clip ids are handed out in creation order.
    order by c."id" asc
  `;

  return { sql, params: [id] };
}

// The episode columns both queries select, spelled once so the mapping to
// `EpisodeDto` can be written once too.
export interface EpisodeColumns {
  id: number;
  title: string;
  cover: string;
  file: string;
  original_url: string;
  date: string;
}

// One row of `buildEpisodeListQuery`. Every episode column is nullable because
// of the `total`-always-wins left join: a page past the end still returns one
// row carrying nothing but the total.
export interface EpisodeListRow {
  total: number;
  id: number | null;
  title: string | null;
  cover: string | null;
  file: string | null;
  original_url: string | null;
  date: string | null;
  clip_count: number;
}

export type PopulatedEpisodeListRow = EpisodeListRow & EpisodeColumns;

export function isPopulatedEpisodeRow(row: EpisodeListRow): row is PopulatedEpisodeListRow {
  return row.id !== null;
}

// One row of `buildEpisodeDetailQuery`: the episode columns repeated per clip,
// with the clip columns null when the episode has no clips at all.
export interface EpisodeDetailRow extends EpisodeColumns {
  clip_id: number | null;
  clip_title: string | null;
  clip_start: number | null;
  clip_end: number | null;
  up: number;
  tags: string[];
}

export type PopulatedEpisodeDetailRow = EpisodeDetailRow & {
  clip_id: number;
  clip_title: string;
  clip_start: number;
  clip_end: number;
};

export function hasClip(row: EpisodeDetailRow): row is PopulatedEpisodeDetailRow {
  return row.clip_id !== null;
}
