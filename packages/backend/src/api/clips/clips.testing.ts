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
import { ClipsModule } from './clips.module';

// Harness for the clips integration suite: a database of its OWN, built by the
// real baseline migration, with a Nest app wired the way `main.ts` wires the
// real one (global `api` prefix, the same `ValidationPipe` options).
//
// ⚠️ A dedicated database, never `gravindex`. The suites share one postgres
// server, and a suite that recreates a shared database destroys somebody else's
// fixtures — or the real data.

// Deliberately NOT read from `DB_NAME`: this must not be able to point at the
// real database by inheriting an environment variable.
export const TEST_DB_NAME = 'gravindex_test_clips';

function connectionSettings() {
  return {
    host: process.env.DB_HOST ?? 'localhost',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5433,
    user: process.env.DB_USER ?? 'gravindex',
    password: process.env.DB_PASSWORD ?? 'gravindex',
  };
}

// `create database` cannot run on the connection that will then use it, so this
// goes through the `postgres` maintenance database first. ⚠️ Through MikroORM
// rather than the `pg` client directly: `pg` ships no types and `@types/pg` is
// not a dependency of this package, and adding one just to write a test is not
// an option.
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

    // `with (force)` terminates leftover sessions from an interrupted run
    // instead of failing with "database is being accessed by other users".
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
          // ⚠️ THE REAL MIGRATIONS, all of them, discovered from `src/` rather
          // than from a hand-kept list: migrations keep being added to this
          // folder, and a list would silently test an out-of-date schema. `preferTs` points the migrator at the sources because a
          // ts-jest run has no reason to have built `dist/`.
          //
          // Using `schema.createSchema()` instead would test a schema this
          // project never deploys — and would skip `create extension unaccent`,
          // without which every search assertion in the suite fails.
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
      ClipsModule,
    ],
  }).compile();

  const orm = moduleRef.get(MikroORM);
  await orm.migrator.up();

  const app = moduleRef.createNestApplication();

  // Same prefix and same pipe options as `main.ts`. A suite that validates
  // under different options is a suite that tests a different application.
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe(VALIDATION_PIPE_OPTIONS));

  await app.init();

  return { app, orm };
}

// Inferred rather than declared: MikroORM's driver-specific `MikroORM` type
// carries its entity list in a generic, and spelling it out by hand only
// produces a readonly/mutable mismatch.
export type TestContext = Awaited<ReturnType<typeof createTestContext>>;

export interface SeededIds {
  episodes: Record<'cancion' | 'zombis' | 'anoranza', number>;
  clips: Record<'cancion' | 'sinAcentos' | 'anoranza' | 'zombis' | 'canon', number>;
}

export const seedToken = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// A miniature of the real data, chosen so that every assertion in the suite has
// a distinct expected answer: the three `order` values produce three different
// sequences, and no two filters select the same set.
//
// ⚠️ **Accents everywhere**, because that is where search breaks silently: the
// columns use a binary collation (case- AND accent-sensitive), so the search has
// to normalise both sides itself. 12 of the 102 existing tags carry an accent or
// an ñ.
export async function seed(em: EntityManager): Promise<SeededIds> {
  const episode = (title: string, date: string): Episode =>
    em.create(Episode, {
      title,
      cover: 'https://example.invalid/cover.png',
      file: 'https://example.invalid/audio.mp3',
      originalUrl: `https://example.invalid/${encodeURIComponent(title)}`,
      date: new Date(date),
      description: 'never surfaced',
    });

  const cancionEp = episode('Episodio 1 (Canción del verano)', '2019-01-01T00:00:00Z');
  const zombisEp = episode('Episodio 2 (Zombis)', '2020-06-15T00:00:00Z');
  const anoranzaEp = episode('Episodio 3 (Añoranza)', '2018-03-10T00:00:00Z');

  await em.flush();

  let voter = 0;
  const clip = (
    title: string,
    ep: Episode,
    createdAt: string,
    tags: string[],
    votes: number[],
  ): Clip => {
    const created = new Date(createdAt);
    const entity = em.create(Clip, {
      title,
      start: 10,
      end: 40,
      episode: ep,
      token: seedToken(900 + voter),
      createdAt: created,
    });

    for (const tag of tags) {
      em.create(Tag, { clip: entity, tag, token: seedToken(900 + voter), createdAt: created });
    }
    for (const value of votes) {
      em.create(Vote, { clip: entity, value, token: seedToken(voter++), createdAt: created });
    }

    return entity;
  };

  // ⚠️ **Every vote here is a +1.** That is the data model: the API answers 400
  // to `-1`, so a fixture containing one would be asserting against data no path
  // can produce. The tally below is
  // chosen so the sort order has three distinct scores and one tie at the bottom,
  // which is what makes the id tiebreak observable.
  // up 3 / points 3
  const cancion = clip('La canción del clítoris', cancionEp, '2021-01-01T00:00:00Z', ['Absurdo', 'Monográficos'], [1, 1, 1]); // prettier-ignore
  // no votes at all — the lower id of the tie at zero
  const sinAcentos = clip('Sin acentos aqui', zombisEp, '2022-01-01T00:00:00Z', ['Absurdo'], []); // prettier-ignore
  // up 1 / points 1
  const anoranza = clip('Añoranza mañanera', anoranzaEp, '2020-01-01T00:00:00Z', ['Monográficos', 'Ñoño'], [1]); // prettier-ignore
  // no votes at all, and no tags at all — the higher id of the tie at zero
  const zombis = clip('Zombis en Cádiz', zombisEp, '2023-01-01T00:00:00Z', [], []);
  // up 2 / points 2
  const canon = clip('El último cañón', cancionEp, '2019-06-01T00:00:00Z', ['Absurdo', 'Monográficos', 'Ñoño'], [1, 1]); // prettier-ignore

  await em.flush();

  return {
    episodes: { cancion: cancionEp.id, zombis: zombisEp.id, anoranza: anoranzaEp.id },
    clips: {
      cancion: cancion.id,
      sinAcentos: sinAcentos.id,
      anoranza: anoranza.id,
      zombis: zombis.id,
      canon: canon.id,
    },
  };
}
