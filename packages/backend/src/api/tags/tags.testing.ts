import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { EntityManager, MikroORM, PostgreSqlDriver, defineConfig } from '@mikro-orm/postgresql';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { VALIDATION_PIPE_OPTIONS } from '../../common/validation/validation-pipe.options';
import { Clip } from '../../database/entities/Clip.entity';
import { Episode } from '../../database/entities/Episode.entity';
import { Playback } from '../../database/entities/Playback.entity';
import { Tag } from '../../database/entities/Tag.entity';
import { Vote } from '../../database/entities/Vote.entity';
import { TagsModule } from './tags.module';

// Harness for the tags integration suite. ⚠️ Its OWN database — the suites run
// in parallel jest workers and each recreates its database on the way in, so
// sharing one with the episodes or clips suite would have them destroying each
// other's fixtures. Never `gravindex`.

// Deliberately NOT read from `DB_NAME`: this must not be able to point at the
// real database by inheriting an environment variable.
export const TEST_DB_NAME = 'gravindex_test_tags';

function connectionSettings() {
  return {
    host: process.env.DB_HOST ?? 'localhost',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5433,
    user: process.env.DB_USER ?? 'gravindex',
    password: process.env.DB_PASSWORD ?? 'gravindex',
  };
}

// `create database` cannot run on the connection that will then use it, so this
// goes through the `postgres` maintenance database first.
async function recreateDatabase(): Promise<void> {
  const maintenance = await MikroORM.init(
    defineConfig({
      driver: PostgreSqlDriver,
      metadataProvider: ReflectMetadataProvider,
      ...connectionSettings(),
      dbName: 'postgres',
      entities: [],
      discovery: { warnWhenNoEntities: false },
      allowGlobalContext: true,
      debug: false,
    }),
  );

  try {
    const connection = maintenance.em.getConnection();

    await connection.execute(`drop database if exists "${TEST_DB_NAME}" with (force)`);
    await connection.execute(`create database "${TEST_DB_NAME}"`);
  } finally {
    await maintenance.close(true);
  }
}

export async function createTestContext() {
  await recreateDatabase();

  const moduleRef = await Test.createTestingModule({
    imports: [
      MikroOrmModule.forRoot(
        defineConfig({
          driver: PostgreSqlDriver,
          metadataProvider: ReflectMetadataProvider,
          ...connectionSettings(),
          dbName: TEST_DB_NAME,
          entities: [Clip, Episode, Tag, Vote, Playback],
          // ⚠️ The real migrations, DISCOVERED from the directory rather than
          // listed by hand — several agents add migrations concurrently and a
          // list would silently test yesterday's schema.
          preferTs: true,
          migrations: {
            path: './dist/database/migrations',
            pathTs: './src/database/migrations',
            glob: '!(*.d).{js,ts}',
            tableName: 'mikro_orm_migrations',
            transactional: true,
            allOrNothing: true,
          },
          allowGlobalContext: true,
          debug: false,
        }),
      ),
      TagsModule,
    ],
  }).compile();

  const orm = moduleRef.get(MikroORM);
  await orm.migrator.up();

  const app = moduleRef.createNestApplication();

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe(VALIDATION_PIPE_OPTIONS));

  await app.init();

  return { app, orm };
}

export type TestContext = Awaited<ReturnType<typeof createTestContext>>;

// ⚠️ Chosen to DISCRIMINATE between code-point and linguistic ordering, which is
// the only thing `GET /tags` can get wrong. Each pair below lands differently
// under the two rules:
//
//   `Absurdo` / `absurdo`      capitals first under `C`, interleaved under ICU
//   `LLamadas` / `Labrador`    `LL` first under `C`, `La` first under ICU
//   `Ñoño`                     LAST under `C` (U+00D1 > 'z'), near `N` under ICU
//   `Andy Warhol` / `Anécdotas`  the real pair from the production data
//
// The last three also mirror real production tags (`LLamadas`, `Labrador
// labrador no es`, `Anécdotas`, `Andy Warhol`, `Muñequetes`).
export const SEEDED_TAGS = [
  'Monográficos',
  'absurdo',
  'Ñoño',
  'Absurdo',
  'Labrador',
  'Anécdotas',
  'LLamadas',
  'Canciones',
  'Andy Warhol',
] as const;

// What `GET /tags` must answer: `SEEDED_TAGS` in code-point order.
export const EXPECTED_ORDER: readonly string[] = [
  'Absurdo',
  'Andy Warhol',
  'Anécdotas',
  'Canciones',
  'LLamadas',
  'Labrador',
  'Monográficos',
  'absurdo',
  'Ñoño',
];

// The same list with the counts the seed below produces. `Monográficos` is on
// two clips and everything else on one, which is what makes the grouping do
// visible work — a `count` that always answered 1 would pass a suite that never
// seeded a shared tag.
export const EXPECTED_ROWS: readonly { tag: string; count: number }[] = EXPECTED_ORDER.map(
  (tag) => ({ tag, count: tag === 'Monográficos' ? 2 : 1 }),
);

export interface SeededIds {
  clips: Record<'tagged' | 'alsoTagged' | 'untagged', number>;
}

// Two clips share `Monográficos`, so the `distinct` is doing real work, and one
// clip has no tags at all, so an untagged clip cannot leak an empty string.
export async function seed(em: EntityManager): Promise<SeededIds> {
  const episode = em.create(Episode, {
    title: 'Episodio 1 (Canción del verano)',
    cover: 'https://example.invalid/cover.png',
    file: 'https://example.invalid/audio.mp3',
    originalUrl: 'https://example.invalid/1',
    date: new Date('2019-01-01T00:00:00Z'),
    description: 'never surfaced',
  });

  await em.flush();

  const clip = (title: string, tags: readonly string[]): Clip => {
    const entity = em.create(Clip, {
      title,
      start: 10,
      end: 40,
      episode,
      token: null,
      createdAt: new Date('2021-01-01T00:00:00Z'),
    });

    for (const tag of tags) {
      em.create(Tag, { clip: entity, tag, token: null, createdAt: new Date() });
    }

    return entity;
  };

  const tagged = clip('Con etiquetas', SEEDED_TAGS);
  const alsoTagged = clip('Con una repetida', ['Monográficos']);
  const untagged = clip('Sin etiquetas', []);

  await em.flush();

  return { clips: { tagged: tagged.id, alsoTagged: alsoTagged.id, untagged: untagged.id } };
}
