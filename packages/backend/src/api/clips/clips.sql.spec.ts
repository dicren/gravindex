import { plainToInstance } from 'class-transformer';
import {
  buildClipFilters,
  buildClipListQuery,
  buildRelatedClipsQuery,
  RELATED_CLIPS_LIMIT,
  resolveOrderColumn,
} from './clips.sql';
import { CLIP_ORDER_VALUES, ClipsQueryDto } from './dto/clips-query.dto';

// Pure query construction. No EntityManager, no connection, no postgres — the
// point of keeping `clips.sql.ts` separate from the service.

const query = (plain: Record<string, unknown>): ClipsQueryDto =>
  plainToInstance(ClipsQueryDto, plain, { enableImplicitConversion: true });

describe('resolveOrderColumn', () => {
  it('maps every value the UI sends to a distinct column', () => {
    const columns = CLIP_ORDER_VALUES.map((value) => resolveOrderColumn(value));

    expect(columns).toEqual(['ord_points', 'ord_created_at', 'ord_episode_date']);
    expect(new Set(columns).size).toBe(CLIP_ORDER_VALUES.length);
  });

  it('defaults to points when no order is given', () => {
    expect(resolveOrderColumn(undefined)).toBe('ord_points');
  });

  // ⚠️ The DTO makes an unknown value a 400 before it gets here. This is the
  // second layer: even called directly, no client string can become SQL.
  it.each([
    'bogus',
    'clip.id',
    '(select 1)',
    'id; drop table clip; --',
    'constructor',
    'toString',
    '__proto__',
  ])('never interpolates %p', (order) => {
    expect(resolveOrderColumn(order)).toBe('ord_points');
  });
});

describe('buildClipFilters', () => {
  it('is a no-op when nothing is filtered', () => {
    expect(buildClipFilters({ tags: [] })).toEqual({ sql: 'true', params: [] });
  });

  it('treats an empty search string as absent', () => {
    expect(buildClipFilters({ search: '', tags: [] }).sql).toBe('true');
  });

  it('searches clip title, episode title and tags, all unaccented', () => {
    const { sql, params } = buildClipFilters({ search: 'canción', tags: [] });

    expect(sql).toContain('unaccent(c."title") ilike unaccent(?)');
    expect(sql).toContain('unaccent(e."title") ilike unaccent(?)');
    expect(sql).toContain('unaccent(ts."tag") ilike unaccent(?)');
    expect(params).toEqual(['%canción%', '%canción%', '%canción%']);
  });

  it('binds the search term rather than interpolating it', () => {
    const { sql, params } = buildClipFilters({ search: "%'; drop table clip; --", tags: [] });

    expect(sql).not.toContain('drop table');
    expect(params[0]).toBe("%%'; drop table clip; --%");
  });

  // AND, not OR: one placeholder per tag plus the expected distinct count.
  it('demands every requested tag', () => {
    const { sql, params } = buildClipFilters({ tags: ['Absurdo', 'Canción'] });

    expect(sql).toContain('count(distinct tf."tag")');
    expect(sql).toContain('tf."tag" in (?, ?)');
    expect(params).toEqual(['Absurdo', 'Canción', 2]);
  });

  it('de-duplicates the requested tags so a repeat cannot make the AND unsatisfiable', () => {
    const { params } = buildClipFilters({ tags: ['Absurdo', 'Absurdo'] });

    expect(params).toEqual(['Absurdo', 1]);
  });

  it('combines search and tags with AND', () => {
    const { sql, params } = buildClipFilters({ search: 'zombies', tags: ['Absurdo'] });

    expect(sql).toContain(' and ');
    // Three for the search condition, the tag, three more for the search
    // *inside* the tag condition (see below), then the expected count.
    expect(params).toEqual([
      '%zombies%',
      '%zombies%',
      '%zombies%',
      'Absurdo',
      '%zombies%',
      '%zombies%',
      '%zombies%',
      1,
    ]);
  });

  // ⚠️ REGRESSION: the `search` × `tags[]` interaction.
  //
  // A clip whose titles did not match keeps only the tag rows that matched the
  // search itself, and the tag filter counts just those. Building the two
  // filters as independent subqueries is the obvious reading and the wrong one:
  // `?search=cine&tags[]=Monográficos` is 6 clips, not 14. The full reasoning is
  // at the call site in `clips.sql.ts`.
  describe('the search × tags interaction', () => {
    it('restricts the tag filter to the tags the search left standing', () => {
      const { sql } = buildClipFilters({ search: 'cine', tags: ['Monográficos'] });

      // The tag subquery must itself carry the search, over both titles and the
      // tag being counted.
      expect(sql).toContain('unaccent(tf."tag") ilike unaccent(?)');
      expect(sql).toContain('count(distinct tf."tag")');
    });

    it('leaves the tag filter alone when there is no search', () => {
      const { sql } = buildClipFilters({ tags: ['Monográficos'] });

      expect(sql).not.toContain('unaccent(tf."tag")');
      expect(sql).toContain('tf."tag" in (?)');
    });

    it('treats an empty search as no search here too', () => {
      expect(buildClipFilters({ search: '', tags: ['Cine'] })).toEqual(
        buildClipFilters({ tags: ['Cine'] }),
      );
    });

    it('repeats the search pattern once per placeholder it adds', () => {
      const { sql, params } = buildClipFilters({ search: 'cine', tags: ['Cine', 'Monográficos'] });

      expect((sql.match(/\?/g) ?? []).length).toBe(params.length);
      expect(params.filter((param) => param === '%cine%')).toHaveLength(6);
    });

    it('still binds the search rather than interpolating it inside the tag filter', () => {
      const { sql } = buildClipFilters({ search: "'; drop table tag; --", tags: ['Cine'] });

      expect(sql).not.toContain('drop table');
    });
  });
});

describe('buildClipListQuery', () => {
  it('binds limit and offset last, after the filter parameters', () => {
    const { params } = buildClipListQuery(query({ search: 'x', page: '3', limit: '5' }));

    expect(params.slice(-2)).toEqual([5, 10]);
  });

  it('applies the documented defaults for page and limit', () => {
    expect(buildClipListQuery(query({})).params).toEqual([10, 0]);
  });

  it('orders by the whitelisted column in both the page CTE and the outer query', () => {
    const { sql } = buildClipListQuery(query({ order: 'episode.date' }));

    expect(sql).toContain('order by "ord_episode_date" desc, "id" desc');
    expect(sql).toContain('order by p."ord_episode_date" desc, p."id" desc');
  });

  // The reason `total` is the LEFT side of the join: it always has a row.
  it('left joins the page onto the total, not the other way round', () => {
    const { sql } = buildClipListQuery(query({}));

    expect(sql).toContain('from "total" t');
    expect(sql).toContain('left join "page" p on true');
  });

  it('has exactly as many placeholders as parameters', () => {
    const { sql, params } = buildClipListQuery(
      query({ search: 'canción', tags: ['a', 'b'], page: '2', limit: '4' }),
    );

    expect((sql.match(/\?/g) ?? []).length).toBe(params.length);
  });
});

describe('buildRelatedClipsQuery', () => {
  it('binds the clip id and the limit, and interpolates neither', () => {
    const { sql, params } = buildRelatedClipsQuery(137);

    expect(params).toEqual([137, RELATED_CLIPS_LIMIT]);
    expect(sql).not.toContain('137');
    expect((sql.match(/\?/g) ?? []).length).toBe(params.length);
  });

  it('caps the list at six by default', () => {
    expect(RELATED_CLIPS_LIMIT).toBe(6);
  });

  // ⚠️ The clip shares every one of its own tags, so without this it would
  // always come back first in its own related list.
  it('excludes the clip itself', () => {
    expect(buildRelatedClipsQuery(137).sql).toContain('t2."clip_id" <> t1."clip_id"');
  });

  // ⚠️ **The whole reason this is an endpoint and not `GET /clips?tags[]=…`.**
  // Most clips carry one tag, so filtering by it in the browser returns whatever
  // the default sort produces; the number of SHARED tags is the only thing here
  // that means relatedness.
  it('orders by shared tags first, then by votes, then by id', () => {
    expect(buildRelatedClipsQuery(1).sql).toContain(
      'order by s."shared" desc, coalesce(agg."up", 0) desc, c."id" desc',
    );
  });

  it('joins on the tag string, because a tag is the (clip, tag) pair', () => {
    expect(buildRelatedClipsQuery(1).sql).toContain('inner join "tag" t2 on t2."tag" = t1."tag"');
  });

  // The permalink renders these with the same row component as the library, so
  // the payload has to be the same shape — which is why both queries build it
  // from the same constant.
  it('selects the same payload as a library row', () => {
    const related = buildRelatedClipsQuery(1).sql;

    for (const column of ['"up"', '"points"', '"tags"', '"episode_title"', '"episode_date"']) {
      expect(related).toContain(column);
    }
  });

  it('never selects the description or the submitter token', () => {
    const { sql } = buildRelatedClipsQuery(1);

    expect(sql).not.toContain('description');
    expect(sql).not.toContain('token');
  });
});

// ⚠️ Every vote is positive, so nothing in these queries may count a negative
// one.
describe('negative votes', () => {
  it('is absent from both queries', () => {
    for (const sql of [buildClipListQuery(query({})).sql, buildRelatedClipsQuery(1).sql]) {
      expect(sql).not.toContain('"down"');
      expect(sql).not.toContain('< 0');
    }
  });

  it('emits points from the same expression as up, so they cannot drift', () => {
    const { sql } = buildClipListQuery(query({}));

    expect(sql).toContain('coalesce(agg."up", 0)::int as "up"');
    expect(sql).toContain('coalesce(agg."up", 0)::int as "points"');
  });
});
