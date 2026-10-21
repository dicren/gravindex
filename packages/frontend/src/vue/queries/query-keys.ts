import type { EntryKey } from '@pinia/colada';

/**
 * Every cache key in the app, in one file.
 *
 * ⚠️ **The scheme is `[feature, kind, …arguments]`, and the prefixes are the
 * point.** Pinia Colada matches filters by prefix — `{ key: ['clips'] }` hits
 * `['clips', 'list', …]` and `['clips', 'detail', 178]` alike — so the shape of
 * these arrays *is* the invalidation vocabulary. A flat `['clipList', …]`
 * naming would work exactly once and then force every write to enumerate the
 * keys it touches.
 *
 * ⚠️ Keys are built HERE, never inline at a call site. A write that invalidates
 * `['clip']` while the read registered `['clips']` fails silently: no error, no
 * refetch, just stale data on screen. Sharing the builders is what makes that
 * impossible rather than merely unlikely.
 *
 * The filter object rides inside the list key as a whole. `toCacheKey` sorts
 * object keys before serializing, so `{ page: 1, search: 'x' }` and
 * `{ search: 'x', page: 1 }` are the same entry — and `undefined` values
 * disappear, which is why `useFilteredList` prunes empty filters into
 * `undefined` before it gets here: `search: ''` and "no search" are the same
 * request and must not be two cache entries.
 */

/**
 * The filter half of a list key: whatever the endpoint takes, plus paging.
 *
 * ⚠️ `object`, not `Record<string, unknown>`, and for a concrete reason: an
 * `interface` (which is what `ClipListQuery` and `EpisodeListQuery` are) has no
 * index signature, so TypeScript refuses to pass one as a `Record`. Colada's
 * own key type makes the same concession for the same reason. The requirement
 * that actually matters — JSON-serializable — is not expressible here either
 * way, and is upheld by the ports themselves: every field on those queries is a
 * string, a number or an array of strings.
 */
export type ListQueryKeyInput = object;

export const clipKeys = {
  /** Everything about clips. What `createClip` invalidates. */
  all: (): EntryKey => ['clips'],
  /** Every page of the library, whatever the filter. */
  lists: (): EntryKey => ['clips', 'list'],
  list: (query: ListQueryKeyInput): EntryKey => ['clips', 'list', query],
  /** Every clip permalink. */
  details: (): EntryKey => ['clips', 'detail'],
  detail: (clipId: number): EntryKey => ['clips', 'detail', clipId],
  /** ⚠️ Under `clips` so a new clip invalidates it — publishing one can change
   *  what is related to something else — but NOT under `detail`, whose entries
   *  carry a single clip and would be matched by prefix. */
  related: (clipId: number): EntryKey => ['clips', 'related', clipId],
} as const;

export const episodeKeys = {
  all: (): EntryKey => ['episodes'],
  lists: (): EntryKey => ['episodes', 'list'],
  list: (query: ListQueryKeyInput): EntryKey => ['episodes', 'list', query],
  /** Every episode page — each one lists the clips cut from it. */
  details: (): EntryKey => ['episodes', 'detail'],
  detail: (episodeId: number): EntryKey => ['episodes', 'detail', episodeId],
  /**
   * The calendar's whole catalogue under one filter.
   *
   * ⚠️ **Under `episodes` but NOT under `lists`**: it is not a page of anything,
   * and a prefix match on `episodeKeys.lists()` would drag six requests' worth
   * of rows into every list invalidation. Publishing a clip still reaches it,
   * through `episodeKeys.all()`, which is right — a new cut changes a day's
   * colour.
   */
  calendar: (query: ListQueryKeyInput): EntryKey => ['episodes', 'calendar', query],
  /** ⚠️ Its own bucket, not nested under `detail`: a waveform never changes
   *  once measured, so it must not be invalidated by whatever refetches an
   *  episode's clip list (a new clip cut from it, say). */
  waveform: (episodeId: number, query: ListQueryKeyInput): EntryKey => [
    'episodes',
    'waveform',
    episodeId,
    query,
  ],
} as const;

export const tagKeys = {
  all: (): EntryKey => ['tags'],
  /** The flat list of every distinct tag, which feeds both autocompletes. */
  list: (): EntryKey => ['tags', 'list'],
} as const;

/**
 * The moderation screens.
 *
 * ⚠️ A prefix of its own, deliberately NOT nested under `clips`. `GET /api/admin/clips/:id`
 * is a different endpoint with a different shape — flat, no populated episode,
 * no vote counts — and sharing a key with the public permalink would let one
 * answer be served for the other. It also means an admin edit can invalidate
 * `['clips']` wholesale without touching its own entry, and that a logout can
 * drop everything authenticated in one call: `invalidateQueries({ key: adminKeys.all() })`.
 */
export const adminKeys = {
  all: (): EntryKey => ['admin'],
  /** Every clip open in the moderation screens. */
  clips: (): EntryKey => ['admin', 'clip'],
  clip: (clipId: number): EntryKey => ['admin', 'clip', clipId],
} as const;
