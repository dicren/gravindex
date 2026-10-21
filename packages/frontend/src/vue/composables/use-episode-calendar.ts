import { computed, watch, type ComputedRef, type Ref } from 'vue';
import { useQuery } from '@pinia/colada';

import type { EpisodeListItem } from '#/domain/episodes/episode.entity';
import type { DomainError } from '#/domain/errors';
import { listAllEpisodesUseCase } from '#/config/episodes.config';
import { abortable } from '@/queries/abortable';
import { fetchMarkedEpisodes } from '@/queries/marked-episodes';
import { episodeKeys } from '@/queries/query-keys';
import { useMomentsStore } from '@/stores/moments.store';

/**
 * The calendar's data: every episode under the current filter, bucketed by month
 * and by day.
 *
 * ⚠️ **It asks for the whole catalogue, not a page**, through
 * `ListAllEpisodesUseCase` — six requests of 100. The calendar draws 208 months
 * at once and there is no page of that.
 *
 * ⚠️ **The three filters of the rail all apply**, and the third one is answered
 * here rather than by the server: `mine` is `Con mis momentos`, which lives in
 * `localStorage` and never reaches the API, so it goes through
 * `queries/marked-episodes.ts` — the same helper the list uses, on purpose.
 */

/** `2011-07`. */
export type MonthKey = string;
/** `2011-07-25`. */
export type DayKey = string;

export interface CalendarBucket {
  readonly episodes: readonly EpisodeListItem[];
  /** How many clips hang off this bucket's episodes, summed. */
  readonly clipCount: number;
}

export interface EpisodeCalendarFilters {
  readonly search: string;
  readonly withClips: boolean;
  readonly mine: boolean;
}

export interface EpisodeCalendar {
  readonly months: ReadonlyMap<MonthKey, CalendarBucket>;
  readonly days: ReadonlyMap<DayKey, CalendarBucket>;
  /** Every day that has an episode, in order — what `‹ ›` walks. */
  readonly dayKeys: readonly DayKey[];
  /** Every year from the first episode to the last, ascending. Empty if none. */
  readonly years: readonly number[];
  /** The most episodes any one month holds — the ribbon's vertical scale. */
  readonly busiestMonth: number;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * ⚠️ **LOCAL date parts, never UTC.** `utils/format-date.ts` prints episode
 * dates in the visitor's own zone, deliberately, so a calendar
 * that bucketed by UTC would put some of the oldest episodes on a different day
 * from the one their own row prints — two answers to the same question, on the
 * same screen.
 */
export function monthKeyOf(date: Date): MonthKey {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function dayKeyOf(date: Date): DayKey {
  return `${monthKeyOf(date)}-${pad(date.getDate())}`;
}

export const yearOf = (key: MonthKey | DayKey): number => Number(key.slice(0, 4));

/** `2011-07` → 7. */
export const monthOf = (key: MonthKey | DayKey): number => Number(key.slice(5, 7));

const EMPTY_CALENDAR: EpisodeCalendar = {
  months: new Map(),
  days: new Map(),
  dayKeys: [],
  years: [],
  busiestMonth: 0,
};

/**
 * Bucket a flat list of episodes into what the two grids draw.
 *
 * Exported for its own test: this is the one piece of the calendar that is pure
 * arithmetic over dates, and it is where a timezone mistake would hide.
 */
export function buildCalendar(episodes: readonly EpisodeListItem[]): EpisodeCalendar {
  if (episodes.length === 0) return EMPTY_CALENDAR;

  const months = new Map<MonthKey, EpisodeListItem[]>();
  const days = new Map<DayKey, EpisodeListItem[]>();
  let first = Infinity;
  let last = -Infinity;

  const push = (into: Map<string, EpisodeListItem[]>, key: string, row: EpisodeListItem): void => {
    const rows = into.get(key);
    if (rows === undefined) into.set(key, [row]);
    else rows.push(row);
  };

  for (const episode of episodes) {
    push(months, monthKeyOf(episode.date), episode);
    push(days, dayKeyOf(episode.date), episode);

    const year = episode.date.getFullYear();
    if (year < first) first = year;
    if (year > last) last = year;
  }

  const toBucket = (rows: EpisodeListItem[]): CalendarBucket => ({
    // Oldest first inside a bucket: a day with two episodes reads in the order
    // they were published, like every other list on the site read backwards.
    episodes: [...rows].sort((a, b) => a.date.getTime() - b.date.getTime() || a.id - b.id),
    clipCount: rows.reduce((sum, row) => sum + row.clipCount, 0),
  });

  return {
    months: new Map([...months].map(([key, rows]) => [key, toBucket(rows)])),
    days: new Map([...days].map(([key, rows]) => [key, toBucket(rows)])),
    dayKeys: [...days.keys()].sort(),
    years: Array.from({ length: last - first + 1 }, (unused, index) => first + index),
    busiestMonth: Math.max(...[...months.values()].map((rows) => rows.length)),
  };
}

export interface UseEpisodeCalendarReturn {
  readonly calendar: ComputedRef<EpisodeCalendar>;
  readonly isPending: ComputedRef<boolean>;
  readonly error: ComputedRef<DomainError | null>;
  readonly refetch: () => Promise<unknown>;
}

export function useEpisodeCalendar(
  filters: Ref<EpisodeCalendarFilters> | ComputedRef<EpisodeCalendarFilters>,
): UseEpisodeCalendarReturn {
  const moments = useMomentsStore();

  const query = useQuery<readonly EpisodeListItem[], DomainError>(() => ({
    key: episodeKeys.calendar({ ...filters.value }),
    query: abortable((signal) =>
      filters.value.mine
        ? fetchMarkedEpisodes(moments.episodeIds, filters.value.search, signal)
        : listAllEpisodesUseCase.execute(
            {
              search: filters.value.search === '' ? undefined : filters.value.search,
              withClips: filters.value.withClips ? true : undefined,
            },
            signal,
          ),
    ),
  }));

  /**
   * ⚠️ **Marking or forgetting a moment has to reach a calendar this browser
   * built.** Same reasoning as the list's watcher: the `mine` entry is keyed by
   * the filter, which never sees the marks, so without this a mark left on an
   * episode would not change the day it falls on until something else moved.
   */
  watch(
    () => moments.episodeIds.join(','),
    () => {
      if (filters.value.mine) void query.refetch();
    },
  );

  return {
    calendar: computed(() => buildCalendar(query.data.value ?? [])),
    isPending: computed(() => query.data.value === undefined && query.isLoading.value),
    error: computed(() => query.error.value),
    refetch: () => query.refetch(),
  };
}
