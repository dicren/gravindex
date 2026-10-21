// Pure query construction for `GET /episodes/:id/waveform`, in the same shape
// as `episodes.sql.ts`: functions over plain values, no `EntityManager`, no
// connection. `EpisodesService` runs these through `em.getConnection().execute()`.

export interface SqlFragment {
  sql: string;
  /** Positional `?` bindings, in the order the placeholders appear in `sql`. */
  params: unknown[];
}

export interface WaveformTotalRow {
  /** `null` when the episode has no row, distinguished from `total_bytes`
   *  being `null` (a real episode with no waveform measured yet) by whether a
   *  row came back at all. */
  total_bytes: number | null;
}

// ⚠️ Deliberately its own round trip, before `buildWaveformSliceQuery`: the
// byte range to ask Postgres for depends on how long the stored waveform IS,
// and there is no way to know that without asking first. At this project's
// scale (~72 KB at most, per the root AGENTS.md) two small round trips cost
// nothing next to the one avoided — sending the whole column across the
// socket for a request that only wanted a few seconds of it.
export function buildWaveformTotalQuery(episodeId: number): SqlFragment {
  const sql = `
    select octet_length(e."waveform") as "total_bytes"
    from "episode" e
    where e."id" = ?
  `;

  return { sql, params: [episodeId] };
}

export interface PendingEpisodeRow {
  id: number;
  file: string;
}

// The one query `WaveformService.processPending` (the cron chain and the CLI
// backfill both go through it) needs to know what is left to do. Raw, like
// the rest of this module, and for the same reason the read endpoint is: no
// entity graph is wanted, just two columns.
export function buildPendingEpisodesQuery(limit: number): SqlFragment {
  const sql = `
    select e."id" as "id", e."file" as "file"
    from "episode" e
    where e."waveform" is null
    order by e."id" asc
    limit ?
  `;

  return { sql, params: [limit] };
}

export interface WaveformSliceRow {
  peaks: Buffer | null;
}

// `offset`/`length` are BYTE offsets already resolved by `sliceBounds` in
// `waveform-peaks.ts` — this function does no clamping of its own, on
// purpose: it is a straight translation of a decision already made, not a
// second place that could disagree with it.
//
// ⚠️ Postgres' `substring(bytea from int for int)` is 1-based, hence `+ 1`
// baked into the query rather than left to the caller to remember.
export function buildWaveformSliceQuery(
  episodeId: number,
  offset: number,
  length: number,
): SqlFragment {
  const sql = `
    select substring(e."waveform" from ? for ?) as "peaks"
    from "episode" e
    where e."id" = ?
  `;

  return { sql, params: [offset + 1, length, episodeId] };
}
