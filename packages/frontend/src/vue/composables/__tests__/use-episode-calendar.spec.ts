import { describe, expect, it } from 'vitest';
import type { EpisodeListItem } from '#/domain/episodes/episode.entity';
import { buildCalendar, dayKeyOf, monthKeyOf } from '../use-episode-calendar';

function episode(id: number, date: Date, clipCount = 0): EpisodeListItem {
  return {
    id,
    title: `Episodio ${id}`,
    cover: 'https://example.test/cover.png',
    file: 'https://example.test/audio.mp3',
    originalUrl: 'https://example.test/episodio',
    date,
    clipCount,
  };
}

/**
 * An instant whose UTC calendar day differs from its LOCAL one, wherever the
 * runner happens to be.
 *
 * ⚠️ In a runner pinned to UTC the two can never differ, so there the assertion
 * below still holds but proves less. Everywhere else it is the whole test.
 */
function straddlingLocalMidnight(): Date {
  const westOfUtc = new Date(2011, 6, 31).getTimezoneOffset() > 0;
  return westOfUtc ? new Date(2011, 6, 31, 23, 30) : new Date(2011, 6, 31, 0, 30);
}

describe('buildCalendar', () => {
  it('groups by month and by day', () => {
    const calendar = buildCalendar([
      episode(1, new Date(2011, 6, 25, 12)),
      episode(2, new Date(2011, 6, 25, 18)),
      episode(3, new Date(2011, 7, 14, 12)),
    ]);

    expect([...calendar.months.keys()].sort()).toEqual(['2011-07', '2011-08']);
    expect(calendar.months.get('2011-07')?.episodes).toHaveLength(2);
    expect(calendar.days.get('2011-07-25')?.episodes.map((row) => row.id)).toEqual([1, 2]);
    expect(calendar.days.get('2011-08-14')?.episodes).toHaveLength(1);
  });

  it('⚠️ buckets by the LOCAL date, the same one the row prints', () => {
    const date = straddlingLocalMidnight();

    const calendar = buildCalendar([episode(1, date)]);

    // Built from the local parts, so this is what `formatDateFull` shows too.
    expect(calendar.days.has('2011-07-31')).toBe(true);
    expect(calendar.months.has('2011-07')).toBe(true);
    // And not from the UTC ones, which on most runners are a different day.
    expect(calendar.days.has(date.toISOString().slice(0, 10))).toBe(
      date.toISOString().slice(0, 10) === '2011-07-31',
    );
  });

  it('sums the clips of a bucket', () => {
    const calendar = buildCalendar([
      episode(1, new Date(2011, 6, 25, 12), 8),
      episode(2, new Date(2011, 6, 30, 12), 3),
    ]);

    expect(calendar.months.get('2011-07')?.clipCount).toBe(11);
    expect(calendar.days.get('2011-07-25')?.clipCount).toBe(8);
  });

  it('lists every day with an episode, in order — what ‹ › walks', () => {
    const calendar = buildCalendar([
      episode(3, new Date(2012, 0, 4, 12)),
      episode(1, new Date(2011, 6, 25, 12)),
      episode(2, new Date(2011, 11, 18, 12)),
    ]);

    expect(calendar.dayKeys).toEqual(['2011-07-25', '2011-12-18', '2012-01-04']);
  });

  it('spans every year between the first episode and the last, gaps included', () => {
    const calendar = buildCalendar([
      episode(1, new Date(2009, 3, 12, 12)),
      episode(2, new Date(2012, 5, 1, 12)),
    ]);

    expect(calendar.years).toEqual([2009, 2010, 2011, 2012]);
  });

  it('reports the busiest month, which is the ribbon’s vertical scale', () => {
    const calendar = buildCalendar([
      episode(1, new Date(2014, 0, 3, 12)),
      episode(2, new Date(2014, 0, 9, 12)),
      episode(3, new Date(2014, 1, 9, 12)),
    ]);

    expect(calendar.busiestMonth).toBe(2);
  });

  it('answers an empty catalogue without inventing a range', () => {
    const calendar = buildCalendar([]);

    expect(calendar.years).toEqual([]);
    expect(calendar.dayKeys).toEqual([]);
    expect(calendar.busiestMonth).toBe(0);
  });

  it('pads its keys, so they sort as text', () => {
    expect(monthKeyOf(new Date(2011, 0, 5, 12))).toBe('2011-01');
    expect(dayKeyOf(new Date(2011, 0, 5, 12))).toBe('2011-01-05');
  });
});
