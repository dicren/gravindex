import request from 'supertest';
import { TagCountDto } from './dto/tag-response.dto';
import {
  createTestContext,
  EXPECTED_ORDER,
  EXPECTED_ROWS,
  seed,
  SEEDED_TAGS,
  TEST_DB_NAME,
  TestContext,
} from './tags.testing';

// ⚠️ **Needs a real postgres** (the compose one, host port 5433) and builds
// `gravindex_test_tags` from the real migrations on every run. It never touches
// the `gravindex` database. The one thing this endpoint can get wrong is the
// ORDER, and the order is a property of the database, so it can only be
// asserted here.

jest.setTimeout(60_000);

let app: TestContext['app'];
let orm: TestContext['orm'];
let http: ReturnType<TestContext['app']['getHttpServer']>;

const tags = () => request(http).get('/api/tags');

async function fetchRows(): Promise<TagCountDto[]> {
  const response = await tags().expect(200);

  return response.body as TagCountDto[];
}

/** Just the tag strings, in the order the endpoint returned them. */
async function fetchTags(): Promise<string[]> {
  return (await fetchRows()).map((row) => row.tag);
}

beforeAll(async () => {
  const context = await createTestContext();

  app = context.app;
  orm = context.orm;
  http = app.getHttpServer();
  await seed(orm.em.fork());
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

describe('GET /tags', () => {
  // ⚠️ A bare array, not `{ results, total }`. It is the only endpoint in the
  // API that answers a naked JSON array, and the frontend's tag filter binds
  // straight to it.
  //
  // ⚠️ **Of objects, not of strings.** The library's tag filter prints every tag
  // with how many clips carry it, and the browser cannot count that from a page
  // of clips. The count is the point of the shape.
  it('answers a flat array of { tag, count }, with no envelope', async () => {
    const body = await fetchRows();

    expect(Array.isArray(body)).toBe(true);
    expect(body.every((row) => typeof row.tag === 'string')).toBe(true);
    expect(body.every((row) => typeof row.count === 'number')).toBe(true);
  });

  // ⚠️ A NUMBER. Postgres' `count` is a bigint and node-postgres hands bigints
  // over as strings, so without the `::int` in the query this would be `"2"` —
  // which sorts and adds up wrong wherever it lands.
  it('counts how many clips carry each tag, as a number', async () => {
    expect(await fetchRows()).toEqual(EXPECTED_ROWS);
  });

  it('carries no field beyond tag and count', async () => {
    for (const row of await fetchRows()) {
      expect(Object.keys(row).sort()).toEqual(['count', 'tag']);
    }
  });

  it('de-duplicates: one entry per distinct tag, however many clips carry it', async () => {
    const body = await fetchTags();

    expect(body).toHaveLength(new Set(SEEDED_TAGS).size);
    expect(new Set(body).size).toBe(body.length);
  });

  // ⚠️ **THE assertion of this module.** Code-point order: every capitalised tag
  // before every lowercase one, `LLamadas` before `Labrador`, `Ñoño` dead last.
  // Without `collate "C"` the database's own `en_US.utf8` collation applies, and
  // under glibc or ICU that is a linguistic sort — `absurdo` first, `Labrador`
  // before `LLamadas`, `Ñoño` next to `Monográficos`.
  it('sorts by code point', async () => {
    expect(await fetchTags()).toEqual(EXPECTED_ORDER);
  });

  it('puts every capitalised tag before every lowercase one', async () => {
    const body = await fetchTags();

    expect(body.indexOf('Monográficos')).toBeLessThan(body.indexOf('absurdo'));
    expect(body.indexOf('Absurdo')).toBeLessThan(body.indexOf('absurdo'));
  });

  it('puts Ñ after every ASCII letter, not next to N', async () => {
    const body = await fetchTags();

    expect(body[body.length - 1]).toBe('Ñoño');
  });

  // The same rule the JS-side sort in `clips.service.ts` applies, proved to
  // agree: whatever postgres returns must equal a code-point sort done here.
  it('agrees with a code-point sort done outside the database', async () => {
    const body = await fetchTags();
    const sorted = [...body].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    expect(body).toEqual(sorted);
  });

  it('takes no parameters and rejects none — there is no query DTO to validate', async () => {
    // ⚠️ Unlike every other endpoint: with no `@Query()` DTO the global pipe has
    // nothing to whitelist, so an unknown parameter is ignored rather than a
    // 400.
    const body = (await request(http).get('/api/tags?foo=1').expect(200)).body as TagCountDto[];

    expect(body).toEqual(EXPECTED_ROWS);
  });
});
