import request from 'supertest';
import { createTestContext, seed, SeededIds, TEST_DB_NAME, TestContext } from './episodes.testing';

// ⚠️ **Needs a real postgres** (the compose one, host port 5433) and builds
// `gravindex_test_episodes` from the real migrations on every run. It never
// touches the `gravindex` database. Everything the episodes module promises
// that a unit test cannot reach lives here: accent-insensitive title search,
// `total` on every path, and the one-query episode detail with its vote
// aggregates.

jest.setTimeout(60_000);

let app: TestContext['app'];
let orm: TestContext['orm'];
let ids: SeededIds;
let http: ReturnType<TestContext['app']['getHttpServer']>;

interface EpisodeBody {
  id: number;
  title: string;
  cover: string;
  file: string;
  originalUrl: string;
  date: string;
  /** Only on `GET /episodes`; the detail carries the clips themselves. */
  clipCount?: number;
}

interface ListBody {
  total: number;
  results: EpisodeBody[];
}

interface ClipBody {
  id: number;
  title: string;
  start: number;
  end: number;
  up: number;
  tags: { clipId: number; tag: string }[];
}

type DetailBody = EpisodeBody & { clips: ClipBody[] };

const list = (query: string) => request(http).get(`/api/episodes${query}`);

async function idsFor(query: string): Promise<number[]> {
  const response = await list(query).expect(200);

  return (response.body as ListBody).results.map((episode) => episode.id);
}

async function totalFor(query: string): Promise<number> {
  const response = await list(query).expect(200);

  return (response.body as ListBody).total;
}

async function detail(id: number): Promise<DetailBody> {
  const response = await request(http).get(`/api/episodes/${id}`).expect(200);

  return response.body as DetailBody;
}

const search = (term: string): string => `?search=${encodeURIComponent(term)}`;

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
});

describe('GET /episodes', () => {
  it('answers the {results, total} envelope', async () => {
    const { body } = await list('').expect(200);

    expect(Object.keys(body as object).sort()).toEqual(['results', 'total']);
    expect((body as ListBody).total).toBe(5);
    expect((body as ListBody).results).toHaveLength(5);
  });

  // ⚠️ The list carries NO clips and NO vote counts — that is what
  // `GET /episodes/:id` is for — and neither `description` (lazy, `select: false`)
  // nor `duration` (null on rows that have none).
  //
  // ⚠️ `clipCount` is the one addition: the episode list prints `7 cortes` /
  // `sin cortes` on every row, and embedding 11 clips to
  // render the number 11 would be a different endpoint.
  it('returns exactly the six episode fields plus the clip count', async () => {
    const [first] = (await list('').expect(200)).body.results as EpisodeBody[];

    expect(first).toBeDefined();
    expect(Object.keys(first!).sort()).toEqual([
      'clipCount',
      'cover',
      'date',
      'file',
      'id',
      'originalUrl',
      'title',
    ]);
    expect(first).not.toHaveProperty('clips');
  });

  // ⚠️ The number the episode rows print. Three of the five seeded
  // episodes have clips — one with three, two with one — which is what makes a
  // count that always answered 1 (or the total, or the page size) fail here.
  it('counts the clips of each episode', async () => {
    const byId = new Map(
      ((await list('').expect(200)).body.results as EpisodeBody[]).map((ep) => [ep.id, ep]),
    );

    expect(byId.get(ids.episodes.zombis)!.clipCount).toBe(3);
    expect(byId.get(ids.episodes.cancion)!.clipCount).toBe(1);
    expect(byId.get(ids.episodes.anoranza)!.clipCount).toBe(1);
  });

  // ⚠️ Zero, not null and not absent: 334 of the 395 production episodes have
  // no clips, so this is the ordinary row on this screen, not the edge case.
  it('reports zero for an episode nothing has been cut from', async () => {
    const [first] = (await list('?search=Sin clips').expect(200)).body.results as EpisodeBody[];

    expect(first!.clipCount).toBe(0);
    expect(typeof first!.clipCount).toBe('number');
  });

  it('renders the publish date as a UTC ISO-8601 string', async () => {
    const [first] = (await list('').expect(200)).body.results as EpisodeBody[];

    expect(first!.date).toBe('2021-09-09T00:00:00.000Z');
    expect(new Date(first!.date).toISOString()).toBe(first!.date);
  });

  it('sorts newest first by publish date', async () => {
    expect(await idsFor('')).toEqual([
      ids.episodes.sinClips, // 2021-09-09
      ids.episodes.zombis, // 2020-06-15
      ids.episodes.cancion, // 2019-01-01
      ids.episodes.anoranza, // 2018-03-10
      ids.episodes.desnudate, // 2017-05-05
    ]);
  });
});

describe('GET /episodes — search', () => {
  // The single most likely silent regression: search must ignore accents in both
  // directions, which in postgres is `unaccent()` + ILIKE.
  it('matches accents in both directions', async () => {
    for (const term of ['Desnúdate', 'desnudate', 'DESNUDATE', 'DeSnUdAtE']) {
      expect(await idsFor(search(term))).toEqual([ids.episodes.desnudate]);
    }
  });

  it('matches ñ as n and back', async () => {
    expect(await idsFor(search('Añoranza'))).toEqual([ids.episodes.anoranza]);
    expect(await idsFor(search('anoranza'))).toEqual([ids.episodes.anoranza]);
  });

  // ⚠️ **Title only** — the asymmetry with `GET /clips`, which also searches
  // the episode title and the tags. Both of these terms exist in the data, on a
  // clip and on a tag, and neither may reach an episode.
  it('does not match a clip title', async () => {
    expect(await totalFor(search('Cádiz'))).toBe(0);
  });

  it('does not match a tag', async () => {
    expect(await totalFor(search('Monográficos'))).toBe(0);
  });

  it('reports a total that matches the rows actually reachable by paging', async () => {
    const total = await totalFor(search('Episodio'));
    const paged: number[] = [];

    for (let page = 1; page <= 6; page++) {
      const body = (await list(`${search('Episodio')}&limit=1&page=${page}`).expect(200))
        .body as ListBody;

      expect(body.total).toBe(total);
      paged.push(...body.results.map((episode) => episode.id));
    }

    expect(total).toBe(5);
    expect(new Set(paged).size).toBe(total);
  });

  it('matches nothing for a term nothing carries', async () => {
    expect(await totalFor(search('zzzznope'))).toBe(0);
    expect(await idsFor(search('zzzznope'))).toEqual([]);
  });

  it('treats an empty search as no search at all', async () => {
    expect(await totalFor('?search=')).toBe(5);
  });
});

describe('GET /episodes — pagination', () => {
  it('slices by page and limit', async () => {
    expect(await idsFor('?limit=2&page=1')).toEqual([ids.episodes.sinClips, ids.episodes.zombis]);
    expect(await idsFor('?limit=2&page=2')).toEqual([ids.episodes.cancion, ids.episodes.anoranza]);
    expect(await idsFor('?limit=2&page=3')).toEqual([ids.episodes.desnudate]);
  });

  // ⚠️ The reason `total` is the left side of the join: the real total is still
  // reported when the requested page is empty.
  it('still reports the real total for a page past the end', async () => {
    const { body } = await list('?page=99').expect(200);

    expect(body).toEqual({ results: [], total: 5 });
  });

  it('reports the real total for a page past the end of a SEARCH too', async () => {
    const { body } = await list(`${search('Desnúdate')}&page=99`).expect(200);

    expect(body).toEqual({ results: [], total: 1 });
  });

  it('accepts the largest limit the UI can ask for', async () => {
    await list('?limit=100').expect(200);
  });
});

// Every one of these is a 400: a malformed or undeclared parameter is rejected,
// never ignored, and never allowed to reach the query.
describe('GET /episodes — validation', () => {
  it.each([
    ['?page=0', 'page below 1'],
    ['?page=-1', 'negative page'],
    ['?page=abc', 'non-numeric page'],
    ['?limit=0', 'limit of zero'],
    ['?limit=-5', 'negative limit'],
    ['?limit=abc', 'non-numeric limit'],
    ['?limit=101', 'limit past the cap'],
    ['?limit=99999', 'limit far past the cap'],
    ['?zzz=1', 'undeclared parameter'],
    ['?order=points', 'order on an endpoint with no sort'],
    ['?search[]=a', 'bracketed search key'],
    ['?search=a&search=b', 'repeated search'],
  ])('400s on %s (%s)', async (query) => {
    await list(query).expect(400);
  });
});

// The `Todos · 395` / `Solo con cortes · 61` toggle. Three of the five seeded
// episodes have clips.
describe('GET /episodes?withClips', () => {
  it('keeps only the episodes something has been cut from', async () => {
    const { body } = await list('?withClips=true').expect(200);

    expect((body as ListBody).total).toBe(3);
    expect((body as ListBody).results.every((ep) => (ep.clipCount ?? 0) > 0)).toBe(true);
  });

  it('answers the same as no filter at all when it is false', async () => {
    expect(await idsFor('?withClips=false')).toEqual(await idsFor(''));
  });

  it('narrows the search rather than replacing it', async () => {
    expect(await idsFor('?search=Sin clips&withClips=true')).toEqual([]);
    expect(await idsFor('?search=Sin clips')).toEqual([ids.episodes.sinClips]);
  });

  // ⚠️ `Boolean('false')` is `true`, so a value that is neither spelling must be
  // a 400 rather than silently meaning "on" — see `strict-boolean.ts`.
  it.each(['1', '0', 'yes', 'maybe'])('400s on withClips=%p', async (value) => {
    await list(`?withClips=${value}`).expect(400);
  });
});

describe('GET /episodes/:id', () => {
  it('returns the episode fields plus its clips', async () => {
    const body = await detail(ids.episodes.zombis);

    expect(Object.keys(body).sort()).toEqual([
      'clips',
      'cover',
      'date',
      'file',
      'id',
      'originalUrl',
      'title',
    ]);
  });

  // ⚠️ The clip shape inside an episode: tags and `up`/`down`, but NO `points`
  // and no nested `episode`.
  it('gives every clip its tags and vote count, and nothing else', async () => {
    const [first] = (await detail(ids.episodes.zombis)).clips;

    expect(first).toBeDefined();
    expect(Object.keys(first!).sort()).toEqual(['end', 'id', 'start', 'tags', 'title', 'up']);
    expect(first).not.toHaveProperty('points');
    expect(first).not.toHaveProperty('episode');
    // ⚠️ No `down` on any payload: every vote is positive.
    expect(first).not.toHaveProperty('down');
  });

  it('lists the clips by ascending id', async () => {
    const body = await detail(ids.episodes.zombis);

    expect(body.clips.map((clip) => clip.id)).toEqual([
      ids.clips.cancion,
      ids.clips.sinAcentos,
      ids.clips.mananera,
    ]);
  });

  // ⚠️ `up` is a number here, and the same field is a number on `GET /clips`.
  it('emits up as a number', async () => {
    const byId = new Map((await detail(ids.episodes.zombis)).clips.map((c) => [c.id, c]));

    expect(byId.get(ids.clips.cancion)).toEqual(expect.objectContaining({ up: 3 }));
    expect(byId.get(ids.clips.sinAcentos)).toEqual(expect.objectContaining({ up: 1 }));
    expect(typeof byId.get(ids.clips.cancion)!.up).toBe('number');
  });

  it('reports zero, not null, for a clip nobody has voted', async () => {
    const clip = (await detail(ids.episodes.zombis)).clips.find((c) => c.id === ids.clips.mananera);

    expect(clip).toEqual(expect.objectContaining({ up: 0 }));
  });

  it('returns tags as {clipId, tag} pairs in code-point order', async () => {
    const clip = (await detail(ids.episodes.zombis)).clips.find(
      (c) => c.id === ids.clips.sinAcentos,
    );

    // ⚠️ `LLamadas` before `absurdo`: code point, not locale. A linguistic
    // collation puts `absurdo` first.
    expect(clip!.tags).toEqual([
      { clipId: ids.clips.sinAcentos, tag: 'LLamadas' },
      { clipId: ids.clips.sinAcentos, tag: 'absurdo' },
    ]);
  });

  it('returns an empty tag list for a clip with none', async () => {
    const body = await detail(ids.episodes.anoranza);

    expect(body.clips.map((clip) => clip.id)).toEqual([ids.clips.cadiz]);
    expect(body.clips[0]!.tags).toEqual([]);
  });

  // The left join is what makes this work: a clipless episode still yields one
  // row, whose clip columns are null.
  it('returns an empty clips array for an episode with no clips', async () => {
    const body = await detail(ids.episodes.sinClips);

    expect(body.clips).toEqual([]);
    expect(body.id).toBe(ids.episodes.sinClips);
  });

  it('never leaks the description, the submitter token or the timestamps', async () => {
    const body = await detail(ids.episodes.zombis);

    expect(body).not.toHaveProperty('description');
    expect(body).not.toHaveProperty('duration');
    expect(JSON.stringify(body)).not.toContain('never surfaced');
    expect(JSON.stringify(body)).not.toContain('00000000-0000-4000');
    expect(body.clips[0]).not.toHaveProperty('createdAt');
  });

  it('404s for an episode that does not exist', async () => {
    await request(http).get('/api/episodes/9999').expect(404);
  });

  // ⚠️ A malformed id is a malformed request: a 400, not a missing episode.
  it.each(['abc', '0', '-1', '1.5'])('400s on id %p', async (id) => {
    await request(http).get(`/api/episodes/${id}`).expect(400);
  });
});
