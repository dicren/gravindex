import { plainToInstance } from 'class-transformer';
import {
  buildEpisodeDetailQuery,
  buildEpisodeFilters,
  buildEpisodeListQuery,
  EpisodeDetailRow,
  EpisodeListRow,
  hasClip,
  isPopulatedEpisodeRow,
} from './episodes.sql';
import { EpisodesQueryDto } from './dto/episodes-query.dto';

// Pure query construction. No EntityManager, no connection, no postgres — the
// point of keeping `episodes.sql.ts` separate from the service.

const query = (plain: Record<string, unknown>): EpisodesQueryDto =>
  plainToInstance(EpisodesQueryDto, plain, { enableImplicitConversion: true });

describe('buildEpisodeFilters', () => {
  it('is a no-op when nothing is filtered', () => {
    expect(buildEpisodeFilters({})).toEqual({ sql: 'true', params: [] });
  });

  it('treats an empty search string as absent', () => {
    expect(buildEpisodeFilters({ search: '' })).toEqual({ sql: 'true', params: [] });
  });

  // ⚠️ TITLE ONLY. `buildClipFilters` searches three things; this searches one,
  // and that narrowness is the contract.
  it('searches the episode title and nothing else', () => {
    const { sql, params } = buildEpisodeFilters({ search: 'Desnúdate' });

    expect(sql).toBe('unaccent(e."title") ilike unaccent(?)');
    expect(params).toEqual(['%Desnúdate%']);
    expect(sql).not.toContain('"clip"');
    expect(sql).not.toContain('"tag"');
  });

  it('binds the search term rather than interpolating it', () => {
    const { sql, params } = buildEpisodeFilters({ search: "%'; drop table episode; --" });

    expect(sql).not.toContain('drop table');
    expect(params).toEqual(["%%'; drop table episode; --%"]);
  });
});

describe('buildEpisodeListQuery', () => {
  it('binds limit and offset last, after the filter parameters', () => {
    const { params } = buildEpisodeListQuery(query({ search: 'x', page: '3', limit: '5' }));

    expect(params).toEqual(['%x%', 5, 10]);
  });

  it('applies the documented defaults for page and limit', () => {
    expect(buildEpisodeListQuery(query({})).params).toEqual([10, 0]);
  });

  // ⚠️ `/episodes` takes no `order` at all — there is no whitelist to get wrong
  // because there is no client-influenced fragment in the first place.
  it('always orders by publish date descending, tie-broken by descending id', () => {
    const { sql } = buildEpisodeListQuery(query({}));

    expect(sql).toContain('order by "ord_date" desc, "id" desc');
    expect(sql).toContain('order by p."ord_date" desc, p."id" desc');
  });

  // The reason `total` is the LEFT side of the join: it always has a row, so a
  // page past the end still reports the real total.
  it('left joins the page onto the total, not the other way round', () => {
    const { sql } = buildEpisodeListQuery(query({}));

    expect(sql).toContain('from "total" t');
    expect(sql).toContain('left join "page" p on true');
  });

  it('never selects the description', () => {
    expect(buildEpisodeListQuery(query({})).sql).not.toContain('description');
  });

  it('has exactly as many placeholders as parameters', () => {
    for (const plain of [{}, { search: 'canción' }, { search: 'x', page: '2', limit: '4' }]) {
      const { sql, params } = buildEpisodeListQuery(query(plain));

      expect((sql.match(/\?/g) ?? []).length).toBe(params.length);
    }
  });
});

describe('buildEpisodeFilters — withClips', () => {
  it('adds nothing when the toggle is off or absent', () => {
    expect(buildEpisodeFilters({}).sql).toBe('true');
    expect(buildEpisodeFilters({ withClips: false }).sql).toBe('true');
  });

  // ⚠️ `exists`, not a count: this clause runs over all 395 episodes inside the
  // `base` CTE, and postgres stops at the first matching clip.
  it('keeps only episodes something has been cut from', () => {
    const { sql, params } = buildEpisodeFilters({ withClips: true });

    expect(sql).toBe('exists (select 1 from "clip" cc where cc."episode_id" = e."id")');
    expect(params).toEqual([]);
  });

  it('combines with the search rather than replacing it', () => {
    const { sql, params } = buildEpisodeFilters({ search: 'zombis', withClips: true });

    expect(sql).toContain('unaccent(e."title") ilike unaccent(?)');
    expect(sql).toContain(' and ');
    expect(sql).toContain('exists (select 1 from "clip" cc');
    expect(params).toEqual(['%zombis%']);
  });
});

describe('buildEpisodeListQuery — the clip count', () => {
  // ⚠️ Counted for the PAGE, not for the whole match set: the join sits below
  // the `page` CTE, so it runs for the 24 rows being returned.
  it('counts the clips per row, below the page CTE', () => {
    const { sql } = buildEpisodeListQuery(query({}));

    expect(sql).toContain('coalesce(cnt."clip_count", 0)::int as "clip_count"');
    expect(sql.indexOf('"page" as')).toBeLessThan(sql.indexOf('cnt."clip_count"'));
  });

  // Most episodes have no clips at all, so this is the normal case rather than
  // the edge one.
  it('reports zero, not null, for an episode with no clips', () => {
    expect(buildEpisodeListQuery(query({})).sql).toContain('coalesce(cnt."clip_count", 0)');
  });
});

describe('buildEpisodeDetailQuery', () => {
  it('binds the id rather than interpolating it', () => {
    const { sql, params } = buildEpisodeDetailQuery(63);

    expect(params).toEqual([63]);
    expect(sql).toContain('where e."id" = ?');
    expect(sql).not.toContain('63');
  });

  // ⚠️ One statement, not two `count()` statements per clip. Two correlated
  // lateral aggregates do it.
  it('aggregates up in the same statement as the clips', () => {
    const { sql } = buildEpisodeDetailQuery(1);

    // Exactly two correlated aggregates — votes and tags — and no third trip.
    expect((sql.match(/left join lateral/g) ?? []).length).toBe(2);
    expect(sql).toContain('as "up"');
  });

  // ⚠️ Every vote is positive, so there is nothing for a `down` column to
  // count.
  it('selects no down column', () => {
    expect(buildEpisodeDetailQuery(1).sql).not.toContain('"down"');
  });

  // No `points`, and no `episode` on the clip: the clip is already inside its episode.
  it('selects no points column', () => {
    expect(buildEpisodeDetailQuery(1).sql).not.toContain('"points"');
  });

  // A clipless episode must still yield a row, or the service would 404 it.
  it('left joins the clips so an episode without any still returns a row', () => {
    expect(buildEpisodeDetailQuery(1).sql).toContain('left join "clip" c');
  });

  it('orders the clips by ascending id and the tags by code point', () => {
    const { sql } = buildEpisodeDetailQuery(1);

    expect(sql).toContain('order by c."id" asc');
    expect(sql).toContain('order by tt."tag" collate "C"');
  });

  it('never selects the description', () => {
    expect(buildEpisodeDetailQuery(1).sql).not.toContain('description');
  });
});

describe('row guards', () => {
  const listRow = (id: number | null): EpisodeListRow => ({
    total: 5,
    id,
    title: null,
    cover: null,
    file: null,
    original_url: null,
    date: null,
    clip_count: 0,
  });

  // The row a page past the end returns: the total, and nothing else.
  it('treats the total-only row as unpopulated', () => {
    expect(isPopulatedEpisodeRow(listRow(null))).toBe(false);
    expect(isPopulatedEpisodeRow(listRow(3))).toBe(true);
  });

  const detailRow = (clipId: number | null): EpisodeDetailRow => ({
    id: 1,
    title: 'Episodio 1',
    cover: 'c',
    file: 'f',
    original_url: 'u',
    date: '2020-01-01T00:00:00.000Z',
    clip_id: clipId,
    clip_title: null,
    clip_start: null,
    clip_end: null,
    up: 0,
    tags: [],
  });

  it('treats the clipless-episode row as carrying no clip', () => {
    expect(hasClip(detailRow(null))).toBe(false);
    expect(hasClip(detailRow(42))).toBe(true);
  });
});
