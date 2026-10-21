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
import { EpisodeAudioProxy } from './episode-audio.proxy';
import { EpisodesModule } from './episodes.module';

// Harness for the episodes integration suite: a database of its OWN, built by
// the real migrations, with a Nest app wired the way `main.ts` wires the real
// one (global `api` prefix, the same `ValidationPipe` options).
//
// ⚠️ A dedicated database, never `gravindex`, and never the one another
// module's suite uses either: several suites run in parallel jest workers and
// each recreates its database on the way in.

// Deliberately NOT read from `DB_NAME`: this must not be able to point at the
// real database by inheriting an environment variable.
export const TEST_DB_NAME = 'gravindex_test_episodes';

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
// not a dependency of this package.
async function recreateDatabase(dbName: string): Promise<void> {
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
    await connection.execute(`drop database if exists "${dbName}" with (force)`);
    await connection.execute(`create database "${dbName}"`);
  } finally {
    await maintenance.close(true);
  }
}

// ⚠️ `dbName` is a parameter, not always `TEST_DB_NAME`: `episode-waveform.
// integration.spec.ts` calls this with its OWN name (`WAVEFORM_TEST_DB_NAME`)
// precisely so two Jest workers recreating a database of the same name at the
// same time — which is what `create database` racing itself against
// `episodes.integration.spec.ts` looked like — cannot happen again. The two
// still share every other line of this harness (schema, seed, app wiring).
//
// `episodeAudioProxy`, when given, replaces the real `EpisodeAudioProxy` —
// `episode-audio.integration.spec.ts` uses it so `GET /episodes/:id/audio` can
// be exercised end to end without this suite ever reaching gravina82.com.
export async function createTestContext(
  dbName: string = TEST_DB_NAME,
  episodeAudioProxy?: EpisodeAudioProxy,
) {
  await recreateDatabase(dbName);

  let builder = Test.createTestingModule({
    imports: [
      MikroOrmModule.forRoot(
        defineConfig({
          driver: PostgreSqlDriver,
          metadataProvider: ReflectMetadataProvider,
          ...connectionSettings(),
          dbName,
          entities: [Clip, Episode, Tag, Vote, Playback],
          // ⚠️ THE REAL MIGRATIONS, all of them, DISCOVERED from `src/` rather
          // than from a hand-kept list: agents are adding migrations to this
          // folder concurrently and a list would silently test yesterday's
          // schema. `preferTs` points the migrator at the sources because a
          // ts-jest run has no reason to have built `dist/`.
          //
          // Using `schema.createSchema()` instead would test a schema this
          // project never deploys — and would skip `create extension unaccent`,
          // without which every search assertion in this suite fails.
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
      EpisodesModule,
    ],
  });

  if (episodeAudioProxy !== undefined) {
    builder = builder.overrideProvider(EpisodeAudioProxy).useValue(episodeAudioProxy);
  }

  const moduleRef = await builder.compile();

  const orm = moduleRef.get(MikroORM);
  await orm.migrator.up();

  const app = moduleRef.createNestApplication();

  // Same prefix and same pipe options as `main.ts`. A suite that validates under
  // different options is a suite that tests a different application.
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
  episodes: Record<'cancion' | 'zombis' | 'anoranza' | 'sinClips' | 'desnudate', number>;
  clips: Record<'canon' | 'cancion' | 'sinAcentos' | 'mananera' | 'cadiz', number>;
}

export const seedToken = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// A miniature of the real data, chosen so that every assertion has a distinct
// expected answer: no two episodes share a publish date, one episode carries
// three clips (so their ordering is observable), two carry none, and every clip
// has a different `up`/`down` pair.
//
// ⚠️ **Accents everywhere**: search ignores accents in both directions, so the
// fixture has to contain them. Several of the tags carry an accent or an ñ.
//
// The tag set is picked to DISCRIMINATE between code-point and linguistic
// ordering: `LLamadas`/`Labrador`, `Absurdo`/`absurdo` and `Ñoño` land in a
// different place under each.
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
  const sinClipsEp = episode('Episodio 4 (Sin clips)', '2021-09-09T00:00:00Z');
  const desnudateEp = episode('Episodio 5 (Desnúdate Mujer)', '2017-05-05T00:00:00Z');

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

  // ⚠️ Created in an order that makes "ascending clip id" observable: the three
  // clips of `zombisEp` are NOT contiguous, so a query that forgot to order
  // them could still pass by accident only if it happened to return insertion
  // order — which is exactly what the assertion pins down.
  //
  // ⚠️ **Every vote here is a +1**, and that is the data model, not a
  // simplification of it: the API answers 400 to `-1`, so a fixture with one in
  // it would be asserting against data no path can produce.
  // up 1
  const canon = clip('El último cañón', cancionEp, '2019-06-01T00:00:00Z', ['Canciones', 'Anécdotas', 'Labrador'], [1]); // prettier-ignore
  // up 3
  const cancion = clip('La canción del clítoris', zombisEp, '2021-01-01T00:00:00Z', ['Absurdo', 'Monográficos'], [1, 1, 1]); // prettier-ignore
  // up 0, no tags
  const cadiz = clip('Zombis en Cádiz', anoranzaEp, '2023-01-01T00:00:00Z', [], []);
  // up 1
  const sinAcentos = clip('Sin acentos aqui', zombisEp, '2022-01-01T00:00:00Z', ['absurdo', 'LLamadas'], [1]); // prettier-ignore
  // up 0
  const mananera = clip('Añoranza mañanera', zombisEp, '2020-01-01T00:00:00Z', ['Ñoño', 'Monográficos', 'Andy Warhol'], []); // prettier-ignore

  await em.flush();

  return {
    episodes: {
      cancion: cancionEp.id,
      zombis: zombisEp.id,
      anoranza: anoranzaEp.id,
      sinClips: sinClipsEp.id,
      desnudate: desnudateEp.id,
    },
    clips: {
      canon: canon.id,
      cancion: cancion.id,
      sinAcentos: sinAcentos.id,
      mananera: mananera.id,
      cadiz: cadiz.id,
    },
  };
}
