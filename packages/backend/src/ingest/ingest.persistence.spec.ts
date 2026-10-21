import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { defineConfig, MikroORM } from '@mikro-orm/postgresql';
import { ConfigService } from '@nestjs/config';
import { Clip } from '../database/entities/Clip.entity';
import { Episode } from '../database/entities/Episode.entity';
import { Playback } from '../database/entities/Playback.entity';
import { Tag } from '../database/entities/Tag.entity';
import { Vote } from '../database/entities/Vote.entity';
import { Migration20260816013825 } from '../database/migrations/Migration20260816013825';
import { Migration20260816120000 } from '../database/migrations/Migration20260816120000';
import { buildMikroOrmOptions } from '../mikro-orm.config';
import { FIXTURE_FACTS, readFeedFixture } from './__fixtures__/feed-fixture';
import { FeedClient } from './feed-client';
import { IngestService } from './ingest.service';

// ⚠️ Real PostgreSQL, and idempotency is the only thing worth this much
// machinery: "running it twice does not duplicate anything" is a claim about
// what the DATABASE ends up holding, and a stubbed EntityManager cannot make it.
//
// ⚠️ Its own database, never `gravindex`. Connection settings come from the same
// `.env` the application reads (`buildMikroOrmOptions`), so nothing is
// hard-coded here, and only the database NAME is overridden.
const TEST_DATABASE = 'gravindex_test_ingest';

// One row as the database actually holds it. Read with raw SQL on purpose: the
// question this file answers is "what changed on disk", and going through the
// ORM's identity map to ask it would be asking the wrong witness.
interface EpisodeRow {
  id: number;
  title: string;
  cover: string;
  file: string;
  original_url: string;
  // ⚠️ Raw SQL bypasses the ORM's type mapping, so the driver hands the
  // timestamp back in whatever shape it likes. That is fine for what this file
  // asks — it just has to be normalised before being read as an instant.
  date: Date | string;
  duration: number | null;
  description: string;
}

const SELECT_ALL =
  'select id, title, cover, file, original_url, date, duration, description from episode order by id';

// Never called: these tests drive `ingestXml`, which takes the feed as a string.
const NO_NETWORK = {
  fetchFeed: () => Promise.reject(new Error('the persistence tests must not use the network')),
} as FeedClient;

describe('ingestion against PostgreSQL', () => {
  jest.setTimeout(120_000);

  const xml = readFeedFixture();
  let orm: MikroORM;
  let service: IngestService;

  beforeAll(async () => {
    // Only the connection is borrowed from the application config — importing
    // it is also what loads the same `.env` the application reads, so nothing
    // about the database lives in this file except its name.
    const app = buildMikroOrmOptions();
    orm = await MikroORM.init(
      defineConfig({
        metadataProvider: ReflectMetadataProvider,
        host: app.host,
        port: app.port,
        user: app.user,
        password: app.password,
        dbName: TEST_DATABASE,
        // Classes rather than a glob: jest never runs `npm run build`, so the
        // compiled entities the application config points at may not exist.
        entities: [Episode, Clip, Tag, Vote, Playback],
        allowGlobalContext: false,
        debug: false,
        migrations: {
          tableName: 'mikro_orm_migrations',
          transactional: true,
          allOrNothing: true,
          snapshot: false,
          // ⚠️ Explicit, for the same reason: the migrator would otherwise scan
          // a `dist/` that a bare `npm test` has not produced. The baseline plus
          // the duration column is exactly what `episode` needs.
          migrationsList: [Migration20260816013825, Migration20260816120000],
        },
      }),
    );

    await orm.schema.ensureDatabase();
    // A leftover schema from an earlier run would hide a broken migration.
    await orm.schema.drop({ dropMigrationsTable: true, dropForeignKeys: true });
    await orm.migrator.up();

    service = new IngestService(orm.em, new ConfigService({}), NO_NETWORK);
  });

  afterAll(async () => {
    await orm?.close(true);
  });

  beforeEach(async () => {
    await orm.em.getConnection().execute('truncate table episode restart identity cascade');
  });

  async function readAll(): Promise<EpisodeRow[]> {
    return orm.em.fork().getConnection().execute<EpisodeRow[]>(SELECT_ALL);
  }

  // The claim the whole ingestion design rests on.
  it('imports the feed once and imports nothing at all the second time', async () => {
    const first = await service.ingestXml(xml);

    expect(first).toMatchObject({
      entries: FIXTURE_FACTS.totalEntries,
      withoutAudio: FIXTURE_FACTS.withoutAudio,
      malformed: 0,
      duplicateLinks: 0,
      inserted: FIXTURE_FACTS.audioEntries,
      alreadyPresent: 0,
      durationsBackfilled: 0,
    });

    const afterFirst = await readAll();
    expect(afterFirst).toHaveLength(FIXTURE_FACTS.audioEntries);

    const second = await service.ingestXml(xml);

    expect(second).toMatchObject({
      inserted: 0,
      alreadyPresent: FIXTURE_FACTS.audioEntries,
      durationsBackfilled: 0,
      duplicateLinks: 0,
    });
    // ⚠️ Not just "no new rows": no field of any row moved either.
    expect(await readAll()).toEqual(afterFirst);
  });

  it('stores every column the episode table needs, with the date as UTC', async () => {
    await service.ingestXml(xml);
    const rows = await readAll();
    const newest = rows.find((row) => row.original_url === FIXTURE_FACTS.newest.originalUrl);

    expect(newest).toMatchObject({
      title: FIXTURE_FACTS.newest.title,
      cover: FIXTURE_FACTS.cover,
      file: FIXTURE_FACTS.newest.file,
      duration: FIXTURE_FACTS.newest.duration,
    });
    expect(new Date(newest?.date ?? 0).toISOString()).toBe(FIXTURE_FACTS.newest.date);
    expect(newest?.description).toBe(FIXTURE_FACTS.newest.description);
    expect(rows.filter((row) => row.duration !== null)).toHaveLength(FIXTURE_FACTS.withDuration);
  });

  // Rows written by an earlier version of the importer are exactly this shape: a
  // per-episode cover, no duration. ⚠️ Ingestion must recognise them by
  // `originalUrl` and must not "improve" them into the generic channel cover.
  it('recognises a row from an earlier import by its originalUrl and only fills in its duration', async () => {
    const earlierCover = 'https://example.com/earlier-import/portada-del-episodio.png';
    const earlierFile = 'https://media.example.com/earlier-import/episodio-8.mp3';
    await orm.em.getConnection().execute(
      `insert into episode (title, cover, file, original_url, date, description)
         values (?, ?, ?, ?, ?, ?)`,
      [
        'Título tal y como lo guardó la importación anterior',
        earlierCover,
        earlierFile,
        FIXTURE_FACTS.newest.originalUrl,
        new Date(FIXTURE_FACTS.newest.date),
        'descripción original',
      ],
    );

    const summary = await service.ingestXml(xml);

    expect(summary).toMatchObject({
      inserted: FIXTURE_FACTS.audioEntries - 1,
      alreadyPresent: 1,
      durationsBackfilled: 1,
    });

    const rows = await readAll();
    const earlier = rows.find((row) => row.id === 1);
    expect(earlier).toMatchObject({
      title: 'Título tal y como lo guardó la importación anterior',
      cover: earlierCover,
      file: earlierFile,
      description: 'descripción original',
      duration: FIXTURE_FACTS.newest.duration,
    });
    expect(rows).toHaveLength(FIXTURE_FACTS.audioEntries);
  });

  it('backfills a duration only once', async () => {
    await service.ingestXml(xml);

    expect((await service.ingestXml(xml)).durationsBackfilled).toBe(0);
  });
});
