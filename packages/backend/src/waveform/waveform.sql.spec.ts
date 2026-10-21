import {
  buildPendingEpisodesQuery,
  buildWaveformSliceQuery,
  buildWaveformTotalQuery,
} from './waveform.sql';

// Pure query construction. No EntityManager, no connection, no postgres.

describe('buildWaveformTotalQuery', () => {
  it('binds the episode id and asks for octet_length', () => {
    const { sql, params } = buildWaveformTotalQuery(42);

    expect(sql).toContain('octet_length(e."waveform")');
    expect(sql).toContain('where e."id" = ?');
    expect(params).toEqual([42]);
  });
});

describe('buildWaveformSliceQuery', () => {
  it('binds a 1-based offset (Postgres substring semantics), a length and the id', () => {
    const { sql, params } = buildWaveformSliceQuery(42, 100, 50);

    expect(sql).toContain('substring(e."waveform" from ? for ?)');
    // offset 100 (0-based) becomes 101 for `substring`.
    expect(params).toEqual([101, 50, 42]);
  });

  it('does no clamping of its own — a negative or oversized length is passed straight through', () => {
    const { params } = buildWaveformSliceQuery(1, -5, 999_999);

    expect(params).toEqual([-4, 999_999, 1]);
  });
});

describe('buildPendingEpisodesQuery', () => {
  it('filters on waveform is null and binds the limit', () => {
    const { sql, params } = buildPendingEpisodesQuery(5);

    expect(sql).toContain('where e."waveform" is null');
    expect(sql).toContain('order by e."id" asc');
    expect(params).toEqual([5]);
  });
});
