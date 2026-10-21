import type { Constructor, MigrationObject } from '@mikro-orm/core';
import { MikroORM, wrap } from '@mikro-orm/core';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import type { Migration } from '@mikro-orm/migrations';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { defineConfig, EntityManager, PostgreSqlDriver } from '@mikro-orm/postgresql';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as dotenv from 'dotenv';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { Clip } from '../database/entities/Clip.entity';
import { Episode } from '../database/entities/Episode.entity';
import { Playback } from '../database/entities/Playback.entity';
import { Tag } from '../database/entities/Tag.entity';
import { User } from '../database/entities/User.entity';
import { Vote } from '../database/entities/Vote.entity';
import { API_PREFIX } from '../openapi';
import { AuthModule } from './auth.module';
import { AuthService } from './auth.service';

// ⚠️ Its OWN database, created and migrated by this suite, never the
// application's. Several agents share this postgres, and a suite that truncates
// `gravindex` would silently destroy whatever anyone else was working against.
// The name is asserted below rather than merely written down.
const TEST_DB = 'gravindex_test_auth';

// Throwaway values, and obviously so: this repository is public. Nothing here
// may look like a credential anyone could try somewhere real.
const JWT_SECRET = 'e2e-signing-key-not-a-secret';
const ADMIN_USERNAME = 'e2e-admin';
const ADMIN_PASSWORD = 'e2e-password-1234';

// ⚠️ A tag with a slash, an accent and a space — the three things that make a
// path segment the wrong place to carry one. If these round-trip, the query
// parameter is doing its job.
const AWKWARD_TAG = 'rock/roll & compañía';

// Same files the runtime reads, same precedence (real environment wins).
// `mikro-orm.config.ts` does this for the CLI, which has no ConfigModule; jest
// has none either.
for (const envFile of ['.env.test', '.env', '../../.env']) {
  dotenv.config({ path: envFile, override: false, quiet: true });
}

/**
 * Every migration in `src/database/migrations`, in filename order — which is
 * chronological, because the names are timestamps.
 *
 * ⚠️ Read off the directory rather than listed by hand, and NOT through the
 * `path` glob the runtime uses. Both halves of that matter:
 *
 *  - The glob would make MikroORM `import()` the files itself, natively, from
 *    inside `node_modules` — bypassing jest's TypeScript transform, which only
 *    ever sees modules jest loads. It would work against `dist/`, i.e. against
 *    whatever was last compiled rather than what is on disk.
 *  - A hand-written list goes stale the moment anyone adds a migration, and
 *    goes stale SILENTLY: the schema simply lacks a column and some unrelated
 *    query fails with "column does not exist". That is not hypothetical — this
 *    suite hit it the first time it ran, half an hour after the list was
 *    written.
 *
 * `jest.requireActual` is jest's own loader, so each file goes through the same
 * transform as the rest of this suite.
 */
function discoverMigrations(): MigrationObject[] {
  const directory = resolve(__dirname, '../database/migrations');

  return readdirSync(directory)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
    .sort()
    .map((file) => {
      const name = file.slice(0, -'.ts'.length);
      const module = jest.requireActual<Record<string, unknown>>(resolve(directory, file));
      const exported = module[name];
      if (typeof exported !== 'function') {
        throw new Error(`${file} does not export a class called ${name}`);
      }
      return { name, class: exported as Constructor<Migration> };
    });
}

function testOrmOptions() {
  return defineConfig({
    metadataProvider: ReflectMetadataProvider,
    // Explicit classes, not the `dist` glob the runtime uses: under jest there
    // is no build, and a glob over compiled output would test whatever was
    // last compiled rather than what is on disk now.
    entities: [Episode, Clip, Tag, Vote, Playback, User],
    dbName: TEST_DB,
    host: process.env.DB_HOST ?? 'localhost',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    allowGlobalContext: false,
    migrations: {
      tableName: 'mikro_orm_migrations',
      migrationsList: discoverMigrations(),
      transactional: true,
      allOrNothing: true,
      snapshot: false,
    },
  });
}

interface Seeded {
  episodeId: number;
  clipId: number;
  otherClipId: number;
  adminId: number;
}

describe('admin surface (HTTP, against a real database)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  let jwt: JwtService;
  let passwordHash: string;
  let seeded: Seeded;

  beforeAll(async () => {
    // Belt and braces: the constant above is the only thing standing between
    // this suite and someone else's data.
    expect(TEST_DB).toContain('test');
    expect(TEST_DB).not.toBe(process.env.DB_NAME);

    process.env.JWT_SECRET = JWT_SECRET;

    const moduleRef = await Test.createTestingModule({
      imports: [
        // `ignoreEnvFile`: the values this module needs are already in
        // `process.env` (dotenv above, plus the secret just set).
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        MikroOrmModule.forRoot({ driver: PostgreSqlDriver, ...testOrmOptions() }),
        AuthModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // ⚠️ Mirrors `main.ts`. It is a copy, and copies drift — but importing
    // `AppModule` here would drag in every other agent's module and make this
    // suite fail for their reasons. The prefix and the pipe are the two things
    // these routes' behaviour actually depends on.
    app.setGlobalPrefix(API_PREFIX);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    // ⚠️ Listening ONCE here, on a loopback ephemeral port, rather than letting
    // supertest start the server on its first request. Since 7.3.0 supertest
    // refcounts those ephemeral servers and closes one as soon as the last
    // pending request settles — and a `Test` built before its sibling finishes
    // (`request(server).patch(…).set('Authorization', \`Bearer ${await
    // adminToken()}\`)` builds the outer request BEFORE the login one) keeps a
    // deferred path that dispatches into `formatServerUrl(server,
    // server.address())`. By then the server is closed, `address()` is `null`
    // and the whole test dies with `Cannot read properties of null (reading
    // 'address')`. With the server listening from the start, supertest takes
    // the plain path and closes nothing. Only the nine tests that log in first
    // hit it, which is what made it look flaky.
    await app.listen(0, '127.0.0.1');

    orm = app.get(MikroORM);
    jwt = app.get(JwtService);
    await orm.schema.ensureDatabase({ create: true });
    // A schema built by the real migrations, from nothing, on every run — so
    // "the migration works" is asserted by every test here, not assumed.
    await orm.schema.drop({ dropMigrationsTable: true });
    await orm.migrator.up();

    // Hashed once: bcrypt at cost 10 is ~100 ms and every test needs the row.
    // Through the service, so the fixture cannot drift from the cost factor the
    // application actually uses.
    passwordHash = await app.get(AuthService).hashPassword(ADMIN_PASSWORD);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    seeded = await reseed();
  });

  // ── helpers ───────────────────────────────────────────────────────────────

  function em(): EntityManager {
    return orm.em.fork() as EntityManager;
  }

  async function reseed(): Promise<Seeded> {
    const fork = em();
    await fork
      .getConnection()
      .execute(
        'truncate table "vote", "playback", "tag", "clip", "episode", "user" restart identity cascade',
      );

    const episode = fork.create(Episode, {
      title: 'Episodio de prueba',
      cover: 'https://example.test/cover.jpg',
      file: 'https://example.test/audio.mp3',
      originalUrl: 'https://example.test/episodio-1',
      date: new Date('2019-04-12T00:00:00Z'),
      description: 'nunca se sirve',
    });

    // ⚠️ No explicit ids. Letting the sequence assign them is what makes the
    // "a deleted id is never reused" assertion meaningful.
    //
    // ⚠️ `createdAt` is passed explicitly on every row below: those entities
    // have a class initializer and a database default, but they do not declare
    // `[OptionalProps]`, so `em.create` demands the field at compile time. That
    // is their modules' call, not this suite's — spelling it out here is
    // cheaper than reaching into files another agent owns.
    const createdAt = new Date('2020-01-01T00:00:00Z');
    const clip = fork.create(Clip, {
      title: 'Un corte cualquiera',
      start: 10,
      end: 40,
      episode,
      createdAt,
    });
    const otherClip = fork.create(Clip, {
      title: 'El clip de control',
      start: 5,
      end: 9,
      episode,
      createdAt,
    });

    // The clip under test carries one of everything that references it — which
    // is exactly what makes a naive `delete from clip` fail.
    fork.create(Vote, { clip, value: 1, token: 'voter-one', createdAt });
    fork.create(Vote, { clip, value: -1, token: 'voter-two', createdAt });
    fork.create(Playback, { clip, createdAt });
    fork.create(Playback, { clip, createdAt });
    fork.create(Tag, { clip, tag: 'humor', createdAt });
    fork.create(Tag, { clip, tag: AWKWARD_TAG, createdAt });

    // The control clip's rows must survive the other one's deletion.
    fork.create(Vote, { clip: otherClip, value: 1, token: 'voter-three', createdAt });
    fork.create(Playback, { clip: otherClip, createdAt });
    fork.create(Tag, { clip: otherClip, tag: 'intacto', createdAt });

    const admin = fork.create(User, { username: ADMIN_USERNAME, passwordHash });

    await fork.flush();
    return {
      episodeId: episode.id,
      clipId: clip.id,
      otherClipId: otherClip.id,
      adminId: admin.id,
    };
  }

  function login(password = ADMIN_PASSWORD, username = ADMIN_USERNAME) {
    return request(app.getHttpServer())
      .post(`/${API_PREFIX}/auth/login`)
      .send({ username, password });
  }

  async function adminToken(): Promise<string> {
    const response = await login().expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  // ── 1. login ──────────────────────────────────────────────────────────────

  describe('POST /api/auth/login', () => {
    it('returns a usable JWT for the right credentials', async () => {
      const response = await login().expect(200);
      const body = response.body as { accessToken: string; username: string };

      expect(body.username).toBe(ADMIN_USERNAME);
      expect(jwt.verify(body.accessToken)).toMatchObject({
        sub: seeded.adminId,
        username: ADMIN_USERNAME,
        scope: 'admin',
      });
      // ⚠️ The account, and nothing else. No hash, no created_at, no row.
      expect(Object.keys(body).sort()).toEqual(['accessToken', 'username']);
    });

    /**
     * ⚠️ A wrong password and an unknown username must be indistinguishable —
     * otherwise the endpoint answers "does this account exist?" to anyone who
     * asks, and there is no rate limiting in front of it (deferred with the
     * proxy, see root CLAUDE.md).
     */
    it('answers a wrong password and an unknown user identically', async () => {
      const wrong = await login('wrong-password').expect(401);
      const unknown = await login(ADMIN_PASSWORD, 'nobody-at-all').expect(401);

      expect(unknown.status).toBe(wrong.status);
      expect(unknown.body).toEqual(wrong.body);
    });

    /**
     * ⚠️ Identical bodies are not enough: skipping the bcrypt comparison when
     * the username is unknown answers in microseconds and leaks the same
     * information through the clock. `AuthService` compares against a decoy
     * hash precisely so it cannot. The floor is a fifth of bcrypt's real cost,
     * so this fails only when the comparison is genuinely skipped.
     */
    it('spends the same bcrypt cost on an unknown username', async () => {
      const start = Date.now();
      await login(ADMIN_PASSWORD, 'nobody-at-all').expect(401);

      expect(Date.now() - start).toBeGreaterThan(20);
    });

    it('validates the body', async () => {
      await request(app.getHttpServer()).post(`/${API_PREFIX}/auth/login`).send({}).expect(400);
      await request(app.getHttpServer())
        .post(`/${API_PREFIX}/auth/login`)
        .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD, role: 'root' })
        .expect(400);
    });
  });

  // ── 2. the guard ──────────────────────────────────────────────────────────

  describe('the admin guard', () => {
    it('lets a valid token through', async () => {
      const response = await request(app.getHttpServer())
        .get(`/${API_PREFIX}/admin/me`)
        .set('Authorization', `Bearer ${await adminToken()}`)
        .expect(200);

      expect(response.body).toEqual({ id: seeded.adminId, username: ADMIN_USERNAME });
    });

    it('rejects a request with no token', async () => {
      await request(app.getHttpServer()).get(`/${API_PREFIX}/admin/me`).expect(401);
    });

    it('rejects a malformed Authorization header', async () => {
      for (const header of [
        'garbage',
        'Bearer',
        'Bearer    ',
        'Basic dXNlcjpwYXNz',
        'Bearer x.y.z',
      ]) {
        await request(app.getHttpServer())
          .get(`/${API_PREFIX}/admin/me`)
          .set('Authorization', header)
          .expect(401);
      }
    });

    it('rejects an expired token', async () => {
      const expired = jwt.sign(
        { sub: seeded.adminId, username: ADMIN_USERNAME, scope: 'admin' },
        { expiresIn: -1 },
      );

      await request(app.getHttpServer())
        .get(`/${API_PREFIX}/admin/me`)
        .set('Authorization', `Bearer ${expired}`)
        .expect(401);
    });

    it('rejects a token signed with a different key', async () => {
      const forged = new JwtService({ secret: 'not-the-key' }).sign({
        sub: seeded.adminId,
        username: ADMIN_USERNAME,
        scope: 'admin',
      });

      await request(app.getHttpServer())
        .get(`/${API_PREFIX}/admin/me`)
        .set('Authorization', `Bearer ${forged}`)
        .expect(401);
    });

    /**
     * ⚠️ **The anonymous voter token is not a credential.** It is a UUID the
     * client generates and keeps in `localStorage`, sent on public writes so a
     * vote can be deduplicated; it is unsigned and anyone can put any value in
     * the header. If the admin surface ever started reading it, every delete
     * endpoint would be open to the world. Nothing in `auth/` looks at it, and
     * this is the assertion that keeps it that way.
     */
    it('refuses a request carrying only an X-Voter-Token', async () => {
      const voterToken = '11111111-2222-3333-4444-555555555555';

      await request(app.getHttpServer())
        .get(`/${API_PREFIX}/admin/me`)
        .set('X-Voter-Token', voterToken)
        .expect(401);

      // ...and it is not a bearer token either, however it is presented.
      await request(app.getHttpServer())
        .get(`/${API_PREFIX}/admin/me`)
        .set('Authorization', `Bearer ${voterToken}`)
        .set('X-Voter-Token', voterToken)
        .expect(401);
    });

    /**
     * Deleting the row is the only revocation this system has — there is no
     * blocklist and a token lives 12 h. It only works because the guard
     * re-reads the account on every request.
     */
    it('refuses a still-valid token whose account was deleted', async () => {
      const token = await adminToken();
      const fork = em();
      await fork.nativeDelete(User, { id: seeded.adminId });

      await request(app.getHttpServer())
        .get(`/${API_PREFIX}/admin/me`)
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('guards every route under /api/admin, not just one', async () => {
      const server = app.getHttpServer();
      await request(server).get(`/${API_PREFIX}/admin/clips/${seeded.clipId}`).expect(401);
      await request(server).patch(`/${API_PREFIX}/admin/clips/${seeded.clipId}`).expect(401);
      await request(server).delete(`/${API_PREFIX}/admin/clips/${seeded.clipId}`).expect(401);
      await request(server).patch(`/${API_PREFIX}/admin/clips/${seeded.clipId}/tags`).expect(401);
      await request(server).delete(`/${API_PREFIX}/admin/clips/${seeded.clipId}/tags`).expect(401);
    });
  });

  // ── 3. the hash never serializes ──────────────────────────────────────────

  describe('the password hash', () => {
    /**
     * ⚠️ **This is the bug this test exists for.** `@ApiHideProperty()` only
     * removes the field from the OpenAPI *spec*, and MikroORM's
     * `wrap(entity).toJSON()` goes on emitting a real bcrypt hash into a live
     * response as soon as a `User` rides along on another entity.
     * `hidden: true` is the guard that actually holds.
     */
    it('is dropped by MikroORM serialization, at any depth', async () => {
      const fork = em();
      const user = await fork.findOneOrFail(User, { username: ADMIN_USERNAME });

      // Readable in code — `hidden` is about serialization, not access, and
      // the login would not work otherwise.
      expect(user.passwordHash).toBe(passwordHash);

      expect(JSON.stringify(wrap(user).toJSON())).not.toContain(passwordHash);
      // The shape that leaks: the user is not the response, it is a property
      // of one. `JSON.stringify` calls the entity's `toJSON` at any
      // depth, so this is the real reproduction.
      expect(JSON.stringify({ clip: { submittedBy: user } })).not.toContain(passwordHash);
      expect(JSON.stringify([{ nested: [{ user }] }])).not.toContain('passwordHash');
    });

    it('is declared hidden in the entity metadata', () => {
      // The property that makes the test above pass. Asserted directly so that
      // deleting it fails here, with a message that says what was deleted,
      // rather than only in whichever response happens to carry a user.
      expect(orm.getMetadata().get(User).properties.passwordHash.hidden).toBe(true);
    });

    it('appears in no response body of any route', async () => {
      const token = await adminToken();
      const auth = { Authorization: `Bearer ${token}` };
      const server = app.getHttpServer();

      const responses = [
        await login(),
        await login('wrong-password'),
        await request(server).get(`/${API_PREFIX}/admin/me`).set(auth),
        await request(server).get(`/${API_PREFIX}/admin/clips/${seeded.clipId}`).set(auth),
        await request(server)
          .patch(`/${API_PREFIX}/admin/clips/${seeded.clipId}`)
          .set(auth)
          .send({ title: 'otro título' }),
        await request(server)
          .patch(`/${API_PREFIX}/admin/clips/${seeded.clipId}/tags`)
          .set(auth)
          .send({ tag: 'humor', newTag: 'humor negro' }),
        await request(server)
          .delete(`/${API_PREFIX}/admin/clips/${seeded.clipId}/tags`)
          .query({ tag: AWKWARD_TAG })
          .set(auth),
        await request(server).delete(`/${API_PREFIX}/admin/clips/${seeded.clipId}`).set(auth),
        await request(server).get(`/${API_PREFIX}/admin/clips/${seeded.clipId}`).set(auth),
      ];

      for (const response of responses) {
        expect(response.text).not.toContain(passwordHash);
        expect(response.text).not.toContain('passwordHash');
        expect(response.text).not.toContain('password_hash');
        // The hash's own prefix, in case a future algorithm change makes the
        // literal comparison above miss.
        expect(response.text).not.toContain('$2b$');
      }
    });
  });

  // ── 4. deleting a clip ────────────────────────────────────────────────────

  describe('DELETE /api/admin/clips/:id', () => {
    it('removes the clip and every row that referenced it', async () => {
      await request(app.getHttpServer())
        .delete(`/${API_PREFIX}/admin/clips/${seeded.clipId}`)
        .set('Authorization', `Bearer ${await adminToken()}`)
        .expect(204);

      const fork = em();
      expect(await fork.count(Clip, { id: seeded.clipId })).toBe(0);
      expect(await fork.count(Vote, { clip: seeded.clipId })).toBe(0);
      expect(await fork.count(Playback, { clip: seeded.clipId })).toBe(0);
      expect(await fork.count(Tag, { clip: seeded.clipId })).toBe(0);

      // ⚠️ And nothing else moved. `on delete restrict` everywhere means a
      // careless `cascade` would have been invisible without this.
      expect(await fork.count(Clip, { id: seeded.otherClipId })).toBe(1);
      expect(await fork.count(Vote, { clip: seeded.otherClipId })).toBe(1);
      expect(await fork.count(Playback, { clip: seeded.otherClipId })).toBe(1);
      expect(await fork.count(Tag, { clip: seeded.otherClipId })).toBe(1);
      expect(await fork.count(Episode, { id: seeded.episodeId })).toBe(1);
    });

    /**
     * ⚠️ Clip ids are PUBLIC URLS (`https://indice.gravina82.com/<id>`), shared
     * since 2019. A reused id would silently point an old link at a different
     * clip. Postgres sequences do not go backwards on delete — this asserts it
     * rather than assuming it, and it is the same mechanism that keeps the two
     * ids already missing from production data 404ing forever.
     */
    it('never lets the freed id come back', async () => {
      const deleted = seeded.clipId;
      await request(app.getHttpServer())
        .delete(`/${API_PREFIX}/admin/clips/${deleted}`)
        .set('Authorization', `Bearer ${await adminToken()}`)
        .expect(204);

      const fork = em();
      const episode = await fork.findOneOrFail(Episode, { id: seeded.episodeId });
      const replacement = fork.create(Clip, {
        title: 'Un clip posterior',
        start: 1,
        end: 2,
        episode,
        createdAt: new Date(),
      });
      await fork.flush();

      expect(replacement.id).toBeGreaterThan(deleted);
      expect(replacement.id).not.toBe(deleted);
    });

    it('404s on a clip that does not exist, and on one just deleted', async () => {
      const token = await adminToken();
      const auth = { Authorization: `Bearer ${token}` };

      await request(app.getHttpServer())
        .delete(`/${API_PREFIX}/admin/clips/999999`)
        .set(auth)
        .expect(404);
      await request(app.getHttpServer())
        .delete(`/${API_PREFIX}/admin/clips/${seeded.clipId}`)
        .set(auth)
        .expect(204);
      await request(app.getHttpServer())
        .delete(`/${API_PREFIX}/admin/clips/${seeded.clipId}`)
        .set(auth)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/${API_PREFIX}/admin/clips/${seeded.clipId}`)
        .set(auth)
        .expect(404);
    });

    it('rejects a non-numeric id before touching anything', async () => {
      await request(app.getHttpServer())
        .delete(`/${API_PREFIX}/admin/clips/not-a-number`)
        .set('Authorization', `Bearer ${await adminToken()}`)
        .expect(400);
    });
  });

  // ── 5. editing ────────────────────────────────────────────────────────────

  describe('PATCH /api/admin/clips/:id', () => {
    it('edits the fields it is given and leaves the rest alone', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/${API_PREFIX}/admin/clips/${seeded.clipId}`)
        .set('Authorization', `Bearer ${await adminToken()}`)
        .send({ title: 'Título corregido', start: 12 })
        .expect(200);

      expect(response.body).toMatchObject({
        id: seeded.clipId,
        title: 'Título corregido',
        start: 12,
        end: 40,
        episodeId: seeded.episodeId,
      });

      // ⚠️ `createdAt` is `lazy` (never selected unless asked), so the update
      // ran on an entity that never loaded it. A flush that wrote the property
      // back as null would rewrite the clip's history and nothing else here
      // would notice — `order=clip.createdAt` is one of the sorts the library
      // page offers.
      const stored = await em().findOneOrFail(
        Clip,
        { id: seeded.clipId },
        { populate: ['createdAt'] },
      );
      expect(stored.title).toBe('Título corregido');
      expect(stored.start).toBe(12);
      expect(stored.end).toBe(40);
      expect(stored.createdAt.toISOString()).toBe('2020-01-01T00:00:00.000Z');
    });

    it('validates the body', async () => {
      const token = await adminToken();
      const auth = { Authorization: `Bearer ${token}` };
      const patch = () =>
        request(app.getHttpServer()).patch(`/${API_PREFIX}/admin/clips/${seeded.clipId}`).set(auth);

      await patch().send({ start: 'no' }).expect(400);
      await patch().send({ start: 1.5 }).expect(400);
      await patch().send({ start: -1 }).expect(400);
      await patch().send({ title: '' }).expect(400);
      await patch().send({ title: '   ' }).expect(400);
      await patch().send({ episodeId: 7 }).expect(400); // not a settable field
    });

    /**
     * ⚠️ Checked against the MERGED values: a PATCH that moves only `start`
     * can still invert the cut, and the body alone cannot see it.
     */
    it('refuses to invert a cut, even from a one-field patch', async () => {
      const auth = { Authorization: `Bearer ${await adminToken()}` };

      await request(app.getHttpServer())
        .patch(`/${API_PREFIX}/admin/clips/${seeded.clipId}`)
        .set(auth)
        .send({ start: 999 })
        .expect(400);

      const untouched = await em().findOneOrFail(Clip, { id: seeded.clipId });
      expect(untouched.start).toBe(10);
    });

    it('404s on an unknown clip', async () => {
      await request(app.getHttpServer())
        .patch(`/${API_PREFIX}/admin/clips/999999`)
        .set('Authorization', `Bearer ${await adminToken()}`)
        .send({ title: 'x' })
        .expect(404);
    });
  });

  describe('the tag routes', () => {
    it('renames a tag on one clip', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/${API_PREFIX}/admin/clips/${seeded.clipId}/tags`)
        .set('Authorization', `Bearer ${await adminToken()}`)
        .send({ tag: 'humor', newTag: 'humor negro' })
        .expect(200);

      expect((response.body as { tags: string[] }).tags.sort()).toEqual(
        [AWKWARD_TAG, 'humor negro'].sort(),
      );
      const fork = em();
      expect(await fork.count(Tag, { clip: seeded.clipId, tag: 'humor' })).toBe(0);
      expect(await fork.count(Tag, { clip: seeded.clipId, tag: 'humor negro' })).toBe(1);
      // The identical tag on another clip is a different row and stays put.
      expect(await fork.count(Tag, { clip: seeded.otherClipId, tag: 'intacto' })).toBe(1);
    });

    it('refuses a rename that would merge two tags into one', async () => {
      await request(app.getHttpServer())
        .patch(`/${API_PREFIX}/admin/clips/${seeded.clipId}/tags`)
        .set('Authorization', `Bearer ${await adminToken()}`)
        .send({ tag: 'humor', newTag: AWKWARD_TAG })
        .expect(409);

      expect(await em().count(Tag, { clip: seeded.clipId })).toBe(2);
    });

    it('validates the rename body', async () => {
      const auth = { Authorization: `Bearer ${await adminToken()}` };
      const patch = () =>
        request(app.getHttpServer())
          .patch(`/${API_PREFIX}/admin/clips/${seeded.clipId}/tags`)
          .set(auth);

      await patch().send({ tag: 'humor' }).expect(400);
      await patch().send({ tag: 'humor', newTag: '' }).expect(400);
      await patch().send({ tag: 'humor', newTag: '  ' }).expect(400);
      await patch().send({ tag: 'humor', newTag: 'x', extra: 1 }).expect(400);
      await patch().send({ tag: 'no existe', newTag: 'x' }).expect(404);
    });

    /**
     * ⚠️ The awkward tag is the point: `rock/roll & compañía` in a path segment
     * is a different route, not a parameter. In a query string it is one
     * `encodeURIComponent` away from being unremarkable.
     */
    it('deletes a tag whose text would not survive a path segment', async () => {
      await request(app.getHttpServer())
        .delete(`/${API_PREFIX}/admin/clips/${seeded.clipId}/tags`)
        .query({ tag: AWKWARD_TAG })
        .set('Authorization', `Bearer ${await adminToken()}`)
        .expect(204);

      const fork = em();
      expect(await fork.count(Tag, { clip: seeded.clipId, tag: AWKWARD_TAG })).toBe(0);
      expect(await fork.count(Tag, { clip: seeded.clipId })).toBe(1);
    });

    it('404s on a tag the clip does not carry, and validates the query', async () => {
      const auth = { Authorization: `Bearer ${await adminToken()}` };
      const server = app.getHttpServer();

      await request(server)
        .delete(`/${API_PREFIX}/admin/clips/${seeded.clipId}/tags`)
        .query({ tag: 'no existe' })
        .set(auth)
        .expect(404);
      await request(server)
        .delete(`/${API_PREFIX}/admin/clips/${seeded.clipId}/tags`)
        .set(auth)
        .expect(400);
    });
  });

  // ── 6. the bootstrap script ───────────────────────────────────────────────

  /**
   * ⚠️ The first admin is inserted BY HAND, so the INSERT has to carry an
   * already-hashed password — a plaintext one fails `bcrypt.compare` and the
   * login answers the same 401 as an unknown username, silently. This runs the
   * documented one-liner and proves its output is a hash this login accepts.
   * Without it, "the script exists" and "the script works" are two different
   * claims.
   */
  it('accepts a password hashed by scripts/hash-password.ts', async () => {
    const bootstrapPassword = 'a-hand-typed-bootstrap-password';
    const script = resolve(__dirname, '../scripts/hash-password.ts');
    const hash = execFileSync(tsxBinary(), [script, bootstrapPassword], {
      encoding: 'utf8',
    }).trim();

    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);

    const fork = em();
    fork.create(User, { username: 'inserted-by-hand', passwordHash: hash });
    await fork.flush();

    const response = await login(bootstrapPassword, 'inserted-by-hand').expect(200);
    expect((response.body as { username: string }).username).toBe('inserted-by-hand');
  }, 60_000);
});

/** The workspace-hoisted `tsx`, or this package's own copy. */
function tsxBinary(): string {
  const candidates = [
    resolve(__dirname, '../../../../node_modules/.bin/tsx'),
    resolve(__dirname, '../../node_modules/.bin/tsx'),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`tsx not found; looked in ${candidates.join(', ')}`);
  return found;
}
