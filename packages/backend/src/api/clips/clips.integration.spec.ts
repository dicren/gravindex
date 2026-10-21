import request from 'supertest';
import { ALREADY_VOTED } from './clips.service';
import {
  createTestContext,
  seed,
  SeededIds,
  seedToken,
  TEST_DB_NAME,
  TestContext,
} from './clips.testing';

// ⚠️ **Needs a real postgres** (the compose one, host port 5433) and builds
// `gravindex_test_clips` from the baseline migration on every run. It never
// touches the `gravindex` database. Everything the clips module promises that a
// unit test cannot reach lives here: accent-insensitive search, the AND tag
// filter, `total` on every path, and the three write contracts.

jest.setTimeout(60_000);

let app: TestContext['app'];
let orm: TestContext['orm'];
let ids: SeededIds;
let http: ReturnType<TestContext['app']['getHttpServer']>;

// A distinct token per test where the identity matters, so the `(clip, token)`
// unique constraint never collides across cases.
let nextToken = 1000;
const freshToken = (): string => seedToken(nextToken++);

interface ListBody {
  total: number;
  results: {
    id: number;
    title: string;
    start: number;
    end: number;
    up: number;
    points: number;
    episode: { id: number; title: string; date: string; originalUrl: string };
    tags: { clipId: number; tag: string }[];
  }[];
}

const list = (query: string) => request(http).get(`/api/clips${query}`);

async function idsFor(query: string): Promise<number[]> {
  const response = await list(query).expect(200);

  return (response.body as ListBody).results.map((clip) => clip.id);
}

async function totalFor(query: string): Promise<number> {
  const response = await list(query).expect(200);

  return (response.body as ListBody).total;
}

async function countRows(sql: string, params: unknown[] = []): Promise<number> {
  const rows = (await orm.em.fork().getConnection().execute(sql, params)) as unknown as {
    count: string;
  }[];

  return Number(rows[0]?.count ?? -1);
}

beforeAll(async () => {
  const context = await createTestContext();

  app = context.app;
  orm = context.orm;
  http = app.getHttpServer();
  ids = await seed(orm.em.fork());
});

afterAll(async () => {
  await app?.close();
  await orm?.close(true);
});

describe('the test database', () => {
  it("is the suite's own, never the shared one", () => {
    expect(orm.config.get('dbName')).toBe(TEST_DB_NAME);
    expect(TEST_DB_NAME).not.toBe('gravindex');
  });

  // ⚠️ No table stores an IP address, and `playback` does not even get the
  // anonymous token the write paths use.
  it('stores no IP address in any table, and no identity at all in playback', async () => {
    const rows = (await orm.em
      .fork()
      .getConnection()
      .execute(
        `select table_name, column_name from information_schema.columns
         where table_schema = 'public' and column_name in ('ip', 'token')
         order by table_name, column_name`,
      )) as unknown as { table_name: string; column_name: string }[];

    expect(rows).toEqual([
      { table_name: 'clip', column_name: 'token' },
      { table_name: 'tag', column_name: 'token' },
      { table_name: 'vote', column_name: 'token' },
    ]);
  });
});

describe('GET /clips', () => {
  it('answers the {results, total} envelope', async () => {
    const { body } = await list('').expect(200);

    expect(Object.keys(body as object).sort()).toEqual(['results', 'total']);
    expect((body as ListBody).total).toBe(5);
    expect((body as ListBody).results).toHaveLength(5);
  });

  it('carries the vote aggregates, the episode and the tags on every row', async () => {
    const { body } = await list('').expect(200);
    const [first] = (body as ListBody).results;

    expect(first).toBeDefined();
    expect(Object.keys(first!).sort()).toEqual([
      'end',
      'episode',
      'id',
      'points',
      'start',
      'tags',
      'title',
      'up',
    ]);
    // ⚠️ `down` is on no payload: every vote is positive.
    expect(first).not.toHaveProperty('down');
    expect(first!.episode.title).toContain('Episodio');
    // The episode's `description` is `lazy` and has never been in the UI.
    expect(first!.episode).not.toHaveProperty('description');
  });

  // ⚠️ These are numbers, never strings. A raw SUM through a left-joined subquery
  // comes back from the driver as a string, but a typed OpenAPI contract cannot
  // honestly say "sometimes a string".
  it('emits up and points as numbers', async () => {
    const { body } = await list('?order=points&limit=1').expect(200);
    const [top] = (body as ListBody).results;

    expect(top).toEqual(expect.objectContaining({ id: ids.clips.cancion, up: 3, points: 3 }));
    expect(typeof top!.up).toBe('number');
    expect(typeof top!.points).toBe('number');
  });

  // ⚠️ `points` is emitted FROM `up` in the query rather than computed a second
  // time, so the sort key cannot disagree with the number printed beside it.
  // With every vote positive they are the same number by construction, and this
  // is what notices if one of them ever starts meaning something else again.
  it('reports points equal to up on every row', async () => {
    const { body } = await list('').expect(200);

    for (const clip of (body as ListBody).results) {
      expect(clip.points).toBe(clip.up);
    }
  });

  it('reports zeroes, not nulls, for a clip nobody has voted', async () => {
    const { body } = await list('?search=Sin acentos').expect(200);

    expect((body as ListBody).results[0]).toEqual(expect.objectContaining({ up: 0, points: 0 }));
  });

  it('returns tags as {clipId, tag} pairs, sorted', async () => {
    const { body } = await list('?search=cañón').expect(200);

    expect((body as ListBody).results[0]!.tags).toEqual([
      { clipId: ids.clips.canon, tag: 'Absurdo' },
      { clipId: ids.clips.canon, tag: 'Monográficos' },
      { clipId: ids.clips.canon, tag: 'Ñoño' },
    ]);
  });

  it('returns an empty tag list for a clip with none', async () => {
    const { body } = await list('?search=Cádiz').expect(200);

    expect((body as ListBody).results[0]!.tags).toEqual([]);
  });
});

describe('GET /clips — search', () => {
  // The most likely silent regression in this area: the columns use a binary
  // collation, so a plain LIKE is case- and accent-sensitive. The fix here is
  // `unaccent()` + ILIKE.
  it('matches accents in both directions', async () => {
    const expected = [ids.clips.cancion, ids.clips.canon].sort();

    for (const term of ['canción', 'cancion', 'CANCION', 'CaNcIóN']) {
      expect((await idsFor(`?search=${encodeURIComponent(term)}`)).sort()).toEqual(expected);
    }
  });

  it('matches ñ as n and back', async () => {
    const expected = [ids.clips.anoranza, ids.clips.canon].sort();

    expect((await idsFor('?search=' + encodeURIComponent('Ñoño'))).sort()).toEqual(expected);
    expect((await idsFor('?search=nono')).sort()).toEqual(expected);
  });

  it('matches the clip title', async () => {
    expect(await idsFor('?search=' + encodeURIComponent('Cádiz'))).toEqual([ids.clips.zombis]);
  });

  it('matches the episode title, so a clip with no matching title still comes back', async () => {
    // 'verano' appears only in the episode title.
    expect((await idsFor('?search=verano')).sort()).toEqual(
      [ids.clips.cancion, ids.clips.canon].sort(),
    );
  });

  it('matches a tag', async () => {
    // 'monograficos' is neither a clip title nor an episode title, and it is
    // spelled without the accent the tag carries.
    expect((await idsFor('?search=monograficos')).sort()).toEqual(
      [ids.clips.cancion, ids.clips.anoranza, ids.clips.canon].sort(),
    );
  });

  it('reports the right total for a search that pages', async () => {
    expect(await totalFor('?search=o&limit=2')).toBe(await totalFor('?search=o&limit=100'));
  });

  it('matches nothing for a term nothing carries', async () => {
    expect(await totalFor('?search=zzzznope')).toBe(0);
    expect(await idsFor('?search=zzzznope')).toEqual([]);
  });
});

describe('GET /clips — tag filter', () => {
  // The wire format every existing link uses (axios' array serialiser), which
  // express 5's `simple` query parser hands over under the literal key `tags[]`.
  it('accepts the axios `tags[]` spelling', async () => {
    expect((await idsFor('?tags[]=Absurdo')).sort()).toEqual(
      [ids.clips.cancion, ids.clips.sinAcentos, ids.clips.canon].sort(),
    );
  });

  it('accepts the canonical `tags` spelling, repeated and single', async () => {
    expect((await idsFor('?tags=Absurdo')).sort()).toEqual(
      [ids.clips.cancion, ids.clips.sinAcentos, ids.clips.canon].sort(),
    );
  });

  // ⚠️ AND, not OR.
  it('demands every requested tag', async () => {
    expect(
      (await idsFor('?tags[]=Absurdo&tags[]=' + encodeURIComponent('Monográficos'))).sort(),
    ).toEqual([ids.clips.cancion, ids.clips.canon].sort());

    expect(
      await idsFor(
        '?tags[]=Absurdo&tags[]=' +
          encodeURIComponent('Monográficos') +
          '&tags[]=' +
          encodeURIComponent('Ñoño'),
      ),
    ).toEqual([ids.clips.canon]);
  });

  it('collapses a repeated tag instead of making the AND unsatisfiable', async () => {
    expect((await idsFor('?tags[]=Absurdo&tags[]=Absurdo')).length).toBe(3);
  });

  // Exact match, unlike `search`: the tag list the UI offers comes from
  // `GET /tags`, so tags are compared exactly.
  it('is case- and accent-sensitive', async () => {
    expect(await totalFor('?tags[]=absurdo')).toBe(0);
    expect(await totalFor('?tags[]=Monograficos')).toBe(0);
  });

  it('combines with search', async () => {
    expect(await idsFor('?search=cancion&tags[]=' + encodeURIComponent('Ñoño'))).toEqual([
      ids.clips.canon,
    ]);
  });

  // ⚠️ **REGRESSION: `search` and `tags[]` are not independent filters.**
  //
  // When a search is present, a clip satisfies `tags[]=X` only if the search
  // matched its title, its episode's title, or the tag X itself — every other
  // tag is filtered away, row by row, before the tag filter counts it.
  //
  // It looks like a bug and it is the specified behaviour. `clips.sql.ts`
  // carries the reasoning; these tests pin the same shapes on the fixture.
  describe('crossed with search (row-level filtering)', () => {
    it('drops a clip whose OTHER tag is the one the search matched', async () => {
      // 'Ñoño' matches no title at all — it only exists as a tag, on `anoranza`
      // and `canon`. Both also carry 'Monográficos', so two independent filters
      // would return both. Here neither is returned: the search leaves only the
      // 'Ñoño' rows standing, and 'Monográficos' is not among them.
      const path =
        '?search=' + encodeURIComponent('Ñoño') + '&tags[]=' + encodeURIComponent('Monográficos');

      expect(await idsFor(path)).toEqual([]);
      expect(await totalFor(path)).toBe(0);
    });

    it('keeps a clip when the search matched the required tag itself', async () => {
      // Every tag row survives a search that matches the tag being demanded.
      const path =
        '?search=monograficos&tags[]=' + encodeURIComponent('Monográficos') + '&limit=100';

      expect((await idsFor(path)).sort()).toEqual(
        [ids.clips.cancion, ids.clips.anoranza, ids.clips.canon].sort(),
      );
    });

    it('keeps a clip when the search matched its own title', async () => {
      // 'cañón' matches `canon`'s clip title, so all three of its tags survive.
      expect(await idsFor('?search=' + encodeURIComponent('cañón') + '&tags[]=Absurdo')).toEqual([
        ids.clips.canon,
      ]);
    });

    it('keeps a clip when the search matched its EPISODE title', async () => {
      // 'Zombis' is in episode 2's title, which `sinAcentos` belongs to; its
      // own title says nothing about zombies and neither does its tag.
      expect(await idsFor('?search=Zombis&tags[]=Absurdo')).toEqual([ids.clips.sinAcentos]);
    });

    it('leaves a search-only and a tags-only query untouched', async () => {
      // The two regressions this could have caused, asserted from the other
      // side: adding the interaction must not change either filter alone.
      expect((await idsFor('?search=' + encodeURIComponent('Ñoño'))).sort()).toEqual(
        [ids.clips.anoranza, ids.clips.canon].sort(),
      );
      expect((await idsFor('?tags[]=' + encodeURIComponent('Monográficos'))).sort()).toEqual(
        [ids.clips.cancion, ids.clips.anoranza, ids.clips.canon].sort(),
      );
    });

    it('reports a total that agrees with the rows, filtered both ways at once', async () => {
      const path = '?search=monograficos&tags[]=' + encodeURIComponent('Ñoño');

      expect(await totalFor(path)).toBe((await idsFor(path + '&limit=100')).length);
      // `Ñoño` is not matched by 'monograficos', so only the clips whose OTHER
      // tag matched are considered — and neither of them keeps `Ñoño`.
      expect(await totalFor(path)).toBe(0);
    });
  });

  // ⚠️ The total must come from the same query as the rows. A separately computed
  // count can disagree with them, and the total is what the pager divides by.
  it('reports a total that matches the rows actually reachable by paging', async () => {
    const total = await totalFor('?tags[]=Absurdo');
    const paged: number[] = [];

    for (let page = 1; page <= 4; page++) {
      const body = (await list(`?tags[]=Absurdo&limit=1&page=${page}`).expect(200))
        .body as ListBody;

      expect(body.total).toBe(total);
      paged.push(...body.results.map((clip) => clip.id));
    }

    expect(total).toBe(3);
    expect(new Set(paged).size).toBe(total);
  });
});

describe('GET /clips — order', () => {
  it('defaults to points descending, tie-broken by descending id', async () => {
    expect(await idsFor('')).toEqual([
      ids.clips.cancion, // 3
      ids.clips.canon, // 2
      ids.clips.anoranza, // 1
      ids.clips.zombis, // 0, higher id
      ids.clips.sinAcentos, // 0, lower id
    ]);
  });

  it('order=points matches the default', async () => {
    expect(await idsFor('?order=points')).toEqual(await idsFor(''));
  });

  it('order=clip.createdAt sorts by when the clip was cut', async () => {
    expect(await idsFor('?order=clip.createdAt')).toEqual([
      ids.clips.zombis, // 2023
      ids.clips.sinAcentos, // 2022
      ids.clips.cancion, // 2021
      ids.clips.anoranza, // 2020
      ids.clips.canon, // 2019
    ]);
  });

  // ⚠️ `createdAt` is `lazy`, so the entity never selects it. SQL can still ORDER
  // BY a column it does not select, and this proves it.
  it('order=clip.createdAt works even though createdAt is never selected', async () => {
    const { body } = await list('?order=clip.createdAt&limit=1').expect(200);

    expect((body as ListBody).results[0]).not.toHaveProperty('createdAt');
  });

  it('order=episode.date sorts by the episode publish date', async () => {
    expect(await idsFor('?order=episode.date')).toEqual([
      ids.clips.zombis, // 2020-06-15, higher id
      ids.clips.sinAcentos, // 2020-06-15, lower id
      ids.clips.canon, // 2019-01-01, higher id
      ids.clips.cancion, // 2019-01-01, lower id
      ids.clips.anoranza, // 2018-03-10
    ]);
  });

  // ⚠️ `order` must never be interpolated straight into the ORDER BY.
  it.each(['bogus', 'clip.id', 'values.points', '1', 'id; drop table clip; --'])(
    'rejects %p with 400 instead of reaching the database',
    async (order) => {
      await list(`?order=${encodeURIComponent(order)}`).expect(400);
    },
  );

  it('left the clip table intact after the injection attempts', async () => {
    expect(await countRows('select count(*) as count from "clip"')).toBe(5);
  });
});

describe('GET /clips — pagination', () => {
  it('slices by page and limit', async () => {
    expect(await idsFor('?limit=2&page=1')).toEqual([ids.clips.cancion, ids.clips.canon]);
    expect(await idsFor('?limit=2&page=2')).toEqual([ids.clips.anoranza, ids.clips.zombis]);
    expect(await idsFor('?limit=2&page=3')).toEqual([ids.clips.sinAcentos]);
  });

  // ⚠️ The reason `total` is the left side of the join. The frontend divides
  // `total` by `limit` to find the last page, which is how it recovers after a
  // filter is cleared — a `total` of 0 here would strand it.
  it('still reports the real total for a page past the end', async () => {
    const { body } = await list('?page=99').expect(200);

    expect(body).toEqual({ results: [], total: 5 });
  });

  it.each(['?page=0', '?page=-1', '?page=abc', '?limit=0', '?limit=101', '?zzz=1'])(
    'rejects %s',
    async (query) => {
      await list(query).expect(400);
    },
  );

  it('accepts the largest limit the UI can ask for', async () => {
    await list('?limit=100').expect(200);
  });
});

describe('GET /clips/:id', () => {
  it('returns the clip with its episode and tags', async () => {
    const { body } = await request(http).get(`/api/clips/${ids.clips.cancion}`).expect(200);

    expect(Object.keys(body as object).sort()).toEqual([
      'end',
      'episode',
      'id',
      'start',
      'tags',
      'title',
      'up',
    ]);
  });

  // ⚠️ `up` is aggregated at read time, so the permalink and the global player
  // can draw the vote count for a clip opened by URL.
  it('carries up, aggregated at read time', async () => {
    const { body } = await request(http).get(`/api/clips/${ids.clips.cancion}`).expect(200);

    expect(body).toEqual(expect.objectContaining({ up: 3 }));
    expect(typeof (body as { up: unknown }).up).toBe('number');
  });

  it('reports zero, not null, for a clip nobody has voted', async () => {
    const { body } = await request(http).get(`/api/clips/${ids.clips.zombis}`).expect(200);

    expect(body).toEqual(expect.objectContaining({ up: 0 }));
  });

  // ⚠️ Both absent, for two different reasons: `down` because every vote is
  // positive, `points` because it would be a second name for `up` — it survives
  // on `GET /clips` only because `order=points` travels in shared links.
  it('omits down and points on purpose', async () => {
    const { body } = await request(http).get(`/api/clips/${ids.clips.cancion}`).expect(200);

    expect(body).not.toHaveProperty('down');
    expect(body).not.toHaveProperty('points');
  });

  it('never leaks the submitter token or the timestamps', async () => {
    const { body } = await request(http).get(`/api/clips/${ids.clips.cancion}`).expect(200);

    expect(body).not.toHaveProperty('token');
    expect(body).not.toHaveProperty('createdAt');
    expect(JSON.stringify(body)).not.toContain('00000000-0000-4000');
  });

  it('404s for a clip that does not exist — including the ids deleted by hand', async () => {
    await request(http).get('/api/clips/9999').expect(404);
  });

  // A non-numeric id is a 400: the untyped parameter must not reach the database
  // as NaN.
  it('400s for a non-numeric id', async () => {
    await request(http).get('/api/clips/abc').expect(400);
  });
});

// The `Relacionados · comparten tag` strip on the clip permalink. The seed's
// tags are what makes the ordering observable: `cancion`, `canon` and
// `sinAcentos` all carry `Absurdo`, and `cancion` and `canon` also share
// `Monográficos`, so from `cancion` the two-tag match must beat the one-tag one
// however the votes fall.
describe('GET /clips/:id/related', () => {
  const related = (clipId: number) => request(http).get(`/api/clips/${clipId}/related`);

  async function relatedIds(clipId: number): Promise<number[]> {
    const response = await related(clipId).expect(200);

    return (response.body as { id: number }[]).map((clip) => clip.id);
  }

  it('answers a bare array, not an envelope', async () => {
    const { body } = await related(ids.clips.cancion).expect(200);

    expect(Array.isArray(body)).toBe(true);
  });

  // ⚠️ The ordering rule, and the reason this is a real endpoint rather than a
  // tag filter run from the browser. `canon` shares two tags with `cancion`;
  // `sinAcentos` and `anoranza` share one each.
  it('orders by how many tags are shared, before anything else', async () => {
    const [first] = await relatedIds(ids.clips.cancion);

    expect(first).toBe(ids.clips.canon);
  });

  // `sinAcentos` (0 votes) and `anoranza` (1 vote) both share exactly one tag
  // with `cancion`, so the vote count is what separates them.
  it('breaks a tie on shared tags by the vote count', async () => {
    const order = await relatedIds(ids.clips.cancion);

    expect(order.indexOf(ids.clips.anoranza)).toBeLessThan(order.indexOf(ids.clips.sinAcentos));
  });

  it('never includes the clip itself', async () => {
    expect(await relatedIds(ids.clips.cancion)).not.toContain(ids.clips.cancion);
  });

  // ⚠️ Empty, not a 404 and not "everything": with no tags there is nothing to
  // share, and the view uses the empty array to decide not to render the
  // section at all.
  it('answers an empty array for a clip with no tags', async () => {
    expect(await relatedIds(ids.clips.zombis)).toEqual([]);
  });

  it('carries the same fields a library row does, so one component renders both', async () => {
    const { body } = await related(ids.clips.cancion).expect(200);
    const [first] = body as ListBody['results'];

    expect(first).toBeDefined();
    expect(Object.keys(first!).sort()).toEqual([
      'end',
      'episode',
      'id',
      'points',
      'start',
      'tags',
      'title',
      'up',
    ]);
  });

  it('404s for a clip that does not exist', async () => {
    await related(999_999).expect(404);
  });

  it('400s on a malformed id, like every other clip route', async () => {
    await request(http).get('/api/clips/abc/related').expect(400);
  });
});

describe('POST /clips', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    start: 100,
    end: 160,
    title: 'Un clip nuevo con acentós',
    tags: ['Absurdo', 'Nuevo'],
    episode: 0,
    ...over,
  });

  it('creates the clip and its tags, and answers 201', async () => {
    const token = freshToken();
    const response = await request(http)
      .post('/api/clips')
      .set('X-Voter-Token', token)
      .send(body({ episode: ids.episodes.zombis }))
      .expect(201);

    const created = response.body as {
      id: number;
      tags: { tag: string }[];
      episode: { id: number };
    };

    expect(created.episode.id).toBe(ids.episodes.zombis);
    expect(created.tags.map((tag) => tag.tag)).toEqual(['Absurdo', 'Nuevo']);
    expect(response.body).not.toHaveProperty('token');

    // ⚠️ `up: 0` in the creation response AND on the immediate read-back — not
    // a placeholder, a fact: nobody can have voted for a clip published a
    // millisecond ago.
    expect(created).toEqual(expect.objectContaining({ up: 0 }));
    const fetched = await request(http).get(`/api/clips/${created.id}`).expect(200);
    expect(fetched.body).toEqual(expect.objectContaining({ up: 0 }));

    expect(await countRows('select count(*) as count from "clip" where "token" = ?', [token])).toBe(
      1,
    );
    expect(await countRows('select count(*) as count from "tag" where "token" = ?', [token])).toBe(
      2,
    );
  });

  it('accepts a clip with no tags', async () => {
    const response = await request(http)
      .post('/api/clips')
      .send(body({ episode: ids.episodes.cancion, tags: [] }))
      .expect(201);

    expect((response.body as { tags: unknown[] }).tags).toEqual([]);
  });

  // A duplicate tag is collapsed, never sent to the composite primary key.
  it('collapses duplicate tags instead of failing', async () => {
    const response = await request(http)
      .post('/api/clips')
      .send(body({ episode: ids.episodes.cancion, tags: ['Repe', 'Repe'] }))
      .expect(201);

    expect((response.body as { tags: { tag: string }[] }).tags).toEqual([
      { clipId: (response.body as { id: number }).id, tag: 'Repe' },
    ]);
  });

  it('stores no token when the header is absent', async () => {
    const response = await request(http)
      .post('/api/clips')
      .send(body({ episode: ids.episodes.cancion, title: 'Sin token' }))
      .expect(201);

    expect(
      await countRows('select count(*) as count from "clip" where "id" = ? and "token" is null', [
        (response.body as { id: number }).id,
      ]),
    ).toBe(1);
  });

  // ⚠️ Each of these is a 400 from the global `ValidationPipe`, never a stored clip.
  it.each([
    ['end at start', { end: 100 }],
    ['end before start', { end: 1 }],
    ['an empty title', { title: '' }],
    ['a fractional start', { start: 1.5 }],
    ['a negative start', { start: -1 }],
    ['a title past 255 characters', { title: 'x'.repeat(256) }],
    ['an undeclared property', { ip: '203.0.113.1' }],
  ])('rejects %s with 400', async (_label, over) => {
    await request(http)
      .post('/api/clips')
      .send(body({ episode: ids.episodes.cancion, ...over }))
      .expect(400);
  });

  // A missing episode is a 404, never an insert with an undefined episode.
  it('404s when the episode does not exist', async () => {
    await request(http)
      .post('/api/clips')
      .send(body({ episode: 99999 }))
      .expect(404);
  });

  it('400s on a malformed voter token', async () => {
    await request(http)
      .post('/api/clips')
      .set('X-Voter-Token', 'not-a-uuid')
      .send(body({ episode: ids.episodes.cancion }))
      .expect(400);
  });
});

describe('POST /clips/:id/vote/:value', () => {
  const vote = (clipId: number, value: number, token: string) =>
    request(http).post(`/api/clips/${clipId}/vote/${value}`).set('X-Voter-Token', token);

  it('records the first vote and answers 201', async () => {
    const response = await vote(ids.clips.anoranza, 1, freshToken()).expect(201);

    expect(response.body).toEqual({ delete: 0, error: null, add: 1 });
  });

  // ⚠️ **THE quirk.** Not a 409, not a 400 — the ordinary 201 for a POST, with
  // `error` in the body. The frontend branches on this exact string.
  it('answers 201 with an error string, not an HTTP error, for a repeat', async () => {
    const token = freshToken();

    await vote(ids.clips.anoranza, 1, token).expect(201);
    const repeat = await vote(ids.clips.anoranza, 1, token).expect(201);

    expect(repeat.body).toEqual({ delete: 0, error: ALREADY_VOTED, add: 0 });
    expect(ALREADY_VOTED).toBe('you have already voted');
    expect(await countRows('select count(*) as count from "vote" where "token" = ?', [token])).toBe(
      1,
    );
  });

  // ⚠️ **Changing a vote is not possible**, because there is nothing to change
  // it to: a negative value is a 400. The existing vote stays exactly where it
  // was.
  it('400s on a negative vote and leaves the existing vote untouched', async () => {
    const token = freshToken();

    await vote(ids.clips.anoranza, 1, token).expect(201);
    await vote(ids.clips.anoranza, -1, token).expect(400);

    const rows = (await orm.em
      .fork()
      .getConnection()
      .execute('select "value" from "vote" where "token" = ?', [token])) as unknown as {
      value: number;
    }[];
    expect(rows).toEqual([{ value: 1 }]);
  });

  it('moves the aggregates the list reports', async () => {
    const before = (await list(`?search=mañanera`).expect(200)).body as ListBody;
    await vote(ids.clips.anoranza, 1, freshToken()).expect(201);
    const after = (await list(`?search=mañanera`).expect(200)).body as ListBody;

    expect(after.results[0]!.up).toBe(before.results[0]!.up + 1);
    expect(after.results[0]!.points).toBe(before.results[0]!.points + 1);
  });

  // The whole point of moving the dedup into the schema: a read-then-write would
  // let two concurrent requests both find no previous row.
  it('lets exactly one of two simultaneous identical votes through', async () => {
    const token = freshToken();

    const responses = await Promise.all([
      vote(ids.clips.zombis, 1, token),
      vote(ids.clips.zombis, 1, token),
    ]);

    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(responses.filter((response) => response.body.error === ALREADY_VOTED)).toHaveLength(1);
    expect(await countRows('select count(*) as count from "vote" where "token" = ?', [token])).toBe(
      1,
    );
  });

  // ⚠️ `x-forwarded-for` is not read anywhere. Two requests from "different
  // addresses" with the same token are still the same voter.
  it('ignores x-forwarded-for entirely', async () => {
    const token = freshToken();

    await vote(ids.clips.zombis, 1, token).set('X-Forwarded-For', '203.0.113.1').expect(201);
    const repeat = await vote(ids.clips.zombis, 1, token)
      .set('X-Forwarded-For', '198.51.100.7')
      .expect(201);

    expect((repeat.body as { error: string }).error).toBe(ALREADY_VOTED);
  });

  it.each([
    ['a missing token', undefined],
    ['a malformed token', 'not-a-uuid'],
    ['an over-long token', 'x'.repeat(64)],
  ])('400s on %s rather than 500ing or silently skipping the dedup', async (_label, token) => {
    const pending = request(http).post(`/api/clips/${ids.clips.cancion}/vote/1`);

    await (token === undefined ? pending : pending.set('X-Voter-Token', token)).expect(400);
  });

  // `/vote/5` must not store a vote worth five points, and `-1` is not a value
  // this API accepts.
  it.each(['5', '0', '-1', '-2', 'abc'])('400s on value %p', async (value) => {
    await request(http)
      .post(`/api/clips/${ids.clips.cancion}/vote/${value}`)
      .set('X-Voter-Token', freshToken())
      .expect(400);
  });

  // A missing clip is a 404, not a foreign-key violation surfaced as a 500.
  it('404s for a clip that does not exist', async () => {
    await vote(99999, 1, freshToken()).expect(404);
  });
});

describe('POST /clips/:id/tag/:value', () => {
  const tag = (clipId: number, value: string) =>
    request(http).post(`/api/clips/${clipId}/tag/${encodeURIComponent(value)}`);

  it('attaches the tag and answers 201 with the pair', async () => {
    const token = freshToken();
    const response = await tag(ids.clips.zombis, 'Recién puesto')
      .set('X-Voter-Token', token)
      .expect(201);

    expect(response.body).toEqual({ clipId: ids.clips.zombis, tag: 'Recién puesto' });
    expect(response.body).not.toHaveProperty('token');
    expect(await countRows('select count(*) as count from "tag" where "token" = ?', [token])).toBe(
      1,
    );
  });

  // ⚠️ Unlike voting, this one really is an HTTP error. The two write paths
  // disagree with each other and both behaviours are the specification.
  it('409s with "Tag repeated" on a duplicate', async () => {
    await tag(ids.clips.sinAcentos, 'Duplicado').expect(201);
    const repeat = await tag(ids.clips.sinAcentos, 'Duplicado').expect(409);

    expect((repeat.body as { message: string }).message).toBe('Tag repeated');
  });

  it('treats a differently-accented tag as a different tag', async () => {
    await tag(ids.clips.sinAcentos, 'Canción').expect(201);
    await tag(ids.clips.sinAcentos, 'Cancion').expect(201);
  });

  it('accepts a missing token and stores null', async () => {
    await tag(ids.clips.sinAcentos, 'Anónimo').expect(201);

    expect(
      await countRows('select count(*) as count from "tag" where "tag" = ? and "token" is null', [
        'Anónimo',
      ]),
    ).toBe(1);
  });

  it('400s on a malformed token', async () => {
    await tag(ids.clips.sinAcentos, 'Nunca').set('X-Voter-Token', 'nope').expect(400);
  });

  it('404s for a clip that does not exist', async () => {
    await tag(99999, 'Fantasma').expect(404);
  });

  it('makes the new tag searchable and filterable', async () => {
    await tag(ids.clips.zombis, 'Buscable').expect(201);

    expect(await idsFor('?tags[]=Buscable')).toEqual([ids.clips.zombis]);
    expect(await idsFor('?search=buscable')).toEqual([ids.clips.zombis]);
  });
});

describe('POST /clips/:id/play', () => {
  it('appends exactly one row and answers 201', async () => {
    const before = await countRows('select count(*) as count from "playback"');
    const response = await request(http)
      .post(`/api/clips/${ids.clips.cancion}/play`)
      .set('X-Forwarded-For', '203.0.113.9')
      .expect(201);

    expect(response.body).toEqual({ id: expect.any(Number) });
    expect(await countRows('select count(*) as count from "playback"')).toBe(before + 1);
  });

  it('404s for a clip that does not exist', async () => {
    await request(http).post('/api/clips/99999/play').expect(404);
  });

  it('400s for a non-numeric id', async () => {
    await request(http).post('/api/clips/abc/play').expect(400);
  });
});
