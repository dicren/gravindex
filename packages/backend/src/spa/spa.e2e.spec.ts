import { EntityManager } from '@mikro-orm/postgresql';
import { Global, INestApplication, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { XMLParser } from 'fast-xml-parser';
import { resolve } from 'node:path';
import request from 'supertest';
import { HealthModule } from '../api/health/health.module';
import { Clip } from '../database/entities/Clip.entity';
import { Episode } from '../database/entities/Episode.entity';
import { API_PREFIX } from '../openapi';
import { registerSpa } from './spa.bootstrap';
import { SpaModule } from './spa.module';

// The `curl` this replaces, written down as assertions.
//
// ⚠️ Over HTTP through a real Nest app, and deliberately WITHOUT a database:
// the service reads two entities through the `EntityManager`, so a stub of that
// one collaborator buys the whole routing story — global prefix, middleware
// order, static assets, fallback — with a suite that still runs on a laptop
// with nothing installed. What it cannot prove is that the SQL is right, and
// there is no SQL here to be wrong.

const PUBLIC_URL = 'https://indice.example.test';
const SPA_DIST = resolve(__dirname, '__fixtures__/spa-dist');

// ⚠️ Both hostile characters the brief demands, plus an `&` and an accent: `"`
// closes the `content` attribute, `<` opens a tag, `&` breaks naive escaping,
// and `ó` is what half the real catalogue is made of.
const NASTY_TITLE = 'El "mejor" clip & <script>alert(1)</script> de la sección';

function buildEpisode(): Episode {
  return Object.assign(new Episode(), {
    id: 12,
    title: 'Episodio de «prueba» & compañía',
    cover: 'https://gravina82.com/covers/12.jpg',
    file: 'https://media.blubrry.com/gravina82/12.mp3',
    originalUrl: 'https://gravina82.com/episodio-12',
    date: new Date('2019-04-12T00:00:00Z'),
    description: 'no se sirve nunca',
  });
}

function buildClip(episode: Episode): Clip {
  return Object.assign(new Clip(), {
    id: 42,
    title: NASTY_TITLE,
    start: 60,
    end: 90,
    episode,
  });
}

/**
 * The two `EntityManager` methods `SpaService` uses. Stubbing the class itself
 * would be a hundred lines of noise for a `findOne`.
 */
function createEntityManagerStub(clips: Clip[], episodes: Episode[]): EntityManager {
  const stub = {
    fork: () => stub,
    findOne: (entity: unknown, where: { id: number }) =>
      Promise.resolve(
        entity === Clip
          ? (clips.find((clip) => clip.id === where.id) ?? null)
          : (episodes.find((episode) => episode.id === where.id) ?? null),
      ),
  };

  return stub as unknown as EntityManager;
}

async function createApp(spaDistPath: string, em: EntityManager): Promise<NestExpressApplication> {
  @Global()
  @Module({
    providers: [{ provide: EntityManager, useValue: em }],
    exports: [EntityManager],
  })
  class StubOrmModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [() => ({ PUBLIC_URL, SPA_DIST_PATH: spaDistPath })],
      }),
      StubOrmModule,
      // Stands in for the whole API surface: if the catch-all swallowed the
      // prefix, this is the endpoint that would stop answering.
      HealthModule,
      SpaModule,
    ],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  // ⚠️ Exactly what `main.ts` does, in the same order. The whole point of the
  // suite is the interaction between these two lines: `setGlobalPrefix` is what
  // a catch-all route would lose to, and `registerSpa` is what sidesteps it.
  app.setGlobalPrefix(API_PREFIX);
  registerSpa(app, app.get(ConfigService));
  await app.init();

  return app;
}

const PARSER_OPTIONS = {
  ignoreAttributes: false,
  allowBooleanAttributes: true,
  unpairedTags: ['meta', 'link', 'br', 'img', 'hr', 'input'],
  processEntities: true,
  htmlEntities: true,
  parseTagValue: false,
  parseAttributeValue: false,
  stopNodes: ['*.script'],
};

interface ParsedMetaTag {
  '@_property'?: string;
  '@_name'?: string;
  '@_content'?: string;
}

interface ParsedHead {
  title?: string;
  meta?: ParsedMetaTag[];
}

/**
 * Parse the served document for real and hand back its `<head>`.
 *
 * ⚠️ This is the escaping assertion's teeth. A substring check passes just as
 * happily on a document that a stray `"` has already broken; a parser that
 * decodes entities does not, because a broken attribute simply is not there any
 * more — and the values it returns are comparable to the raw, unescaped title.
 */
function parseHead(html: string): ParsedHead {
  const xml = html.replace(/^<!doctype html>\s*/i, '');
  const parsed: unknown = new XMLParser(PARSER_OPTIONS).parse(xml, PARSER_OPTIONS);
  const head = (parsed as { html: { head: ParsedHead } }).html.head;

  return head;
}

/**
 * The document a browser receives is STRUCTURALLY whole.
 *
 * ⚠️ `parseHead` above cannot see this. A blank page ships a perfectly good
 * `<head>` — that is why the bug survived: the meta tags were right, the
 * crawler was happy, and everything after the injected block had been swallowed
 * by a comment whose `-->` the injector deleted. So the body, the module script
 * and the balance of the comment markers are asserted separately, over the
 * bytes actually sent.
 */
function expectWholeDocument(html: string): void {
  expect((html.match(/<!--/g) ?? []).length).toBe((html.match(/-->/g) ?? []).length);

  const bare = html.replace(/<!--[\s\S]*?-->/g, '');

  expect(bare).not.toContain('<!--');
  expect(bare).toContain('<div id="app"></div>');
  expect(bare).toMatch(/<script\b[^>]*\btype="module"/i);
  expect(bare).toMatch(/<\/body\s*>/i);
  expect(bare).toMatch(/<\/html\s*>/i);
}

function metaContent(head: ParsedHead, key: string): string | undefined {
  return (head.meta ?? []).find((tag) => tag['@_property'] === key || tag['@_name'] === key)?.[
    '@_content'
  ];
}

describe('SPA shell and social previews (HTTP)', () => {
  const episode = buildEpisode();
  const clip = buildClip(episode);
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp(SPA_DIST, createEntityManagerStub([clip], [episode]));
  });

  afterAll(async () => {
    await app.close();
  });

  describe('a clip permalink', () => {
    it('injects the clip’s own OG and Twitter tags', async () => {
      const response = await request(app.getHttpServer()).get('/42').expect(200);

      expect(response.type).toBe('text/html');

      const head = parseHead(response.text);
      const expectedTitle = `${NASTY_TITLE} | Índice gravinero`;
      const expectedDescription = `Clip de ${episode.title}`;

      expect(head.title).toBe(expectedTitle);
      expect(metaContent(head, 'og:title')).toBe(expectedTitle);
      expect(metaContent(head, 'og:description')).toBe(expectedDescription);
      expect(metaContent(head, 'og:image')).toBe(episode.cover);
      expect(metaContent(head, 'og:url')).toBe(`${PUBLIC_URL}/42`);
      expect(metaContent(head, 'twitter:title')).toBe(expectedTitle);
      expect(metaContent(head, 'twitter:description')).toBe(expectedDescription);
      expect(metaContent(head, 'twitter:image')).toBe(episode.cover);
      expect(metaContent(head, 'twitter:card')).toBe('summary_large_image');
    });

    it('serves a page the browser can actually boot, not just a good <head>', async () => {
      // ⚠️ The regression test for the blank page. `/42` came back with correct
      // meta tags and nothing else: no body, no bundle. Client-side navigation
      // to the same route rendered fine, so only a directly-opened shared link
      // ever hit it — the one case that matters for a link people share.
      const response = await request(app.getHttpServer()).get('/42').expect(200);

      expectWholeDocument(response.text);
    });

    it('builds og:url absolutely, from PUBLIC_URL', async () => {
      const response = await request(app.getHttpServer()).get('/42').expect(200);
      const url = metaContent(parseHead(response.text), 'og:url');

      expect(url).toBe('https://indice.example.test/42');
      expect(url?.startsWith('https://')).toBe(true);
      // A relative `og:url` is ignored by every crawler, silently.
      expect(url).not.toMatch(/^\/|^https?:\/\/(?:localhost|127\.)/);
    });

    it('escapes a hostile title instead of letting it write markup', async () => {
      const response = await request(app.getHttpServer()).get('/42').expect(200);

      // Exact escaped strings: `"` and `<` and `&` all neutralised in place,
      // and the accent left alone.
      const escaped =
        'El &quot;mejor&quot; clip &amp; &lt;script&gt;alert(1)&lt;/script&gt; de la sección | Índice gravinero';

      expect(response.text).toContain(`<meta property="og:title" content="${escaped}">`);
      expect(response.text).toContain(`<meta property="twitter:title" content="${escaped}">`);
      expect(response.text).toContain(`<title>${escaped}</title>`);
      // And the raw markup is nowhere: the only <script> is the SPA's bundle.
      expect(response.text).not.toContain('<script>alert(1)</script>');
      expect(response.text.match(/<script/g)).toHaveLength(1);
      // The document still parses, and round-trips back to the raw title.
      expect(parseHead(response.text).title).toBe(`${NASTY_TITLE} | Índice gravinero`);
    });
  });

  describe('an episode permalink', () => {
    it('injects the EPISODE’s tags', async () => {
      const response = await request(app.getHttpServer())
        .get('/episode/12-algun-titulo')
        .expect(200);
      const head = parseHead(response.text);

      expect(head.title).toBe(`${episode.title} | Índice gravinero`);
      expect(metaContent(head, 'og:title')).toBe(`${episode.title} | Índice gravinero`);
      expect(metaContent(head, 'og:image')).toBe(episode.cover);
      expect(metaContent(head, 'og:url')).toBe(`${PUBLIC_URL}/episode/12-algun-titulo`);
      // ⚠️ `description` is `lazy` on the entity and has never been surfaced.
      expect(response.text).not.toContain('no se sirve nunca');
      // The other half of the injected pair, and it broke the same way.
      expectWholeDocument(response.text);
    });

    it('cares only about the leading integer of the slug', async () => {
      const canonical = await request(app.getHttpServer()).get('/episode/12-algun-titulo');
      const nonsense = await request(app.getHttpServer()).get('/episode/12-anything');
      const bare = await request(app.getHttpServer()).get('/episode/12');

      expect(parseHead(nonsense.text).title).toBe(parseHead(canonical.text).title);
      expect(parseHead(bare.text).title).toBe(parseHead(canonical.text).title);
      // Only `og:url` follows the requested path, because that is the URL shared.
      expect(metaContent(parseHead(nonsense.text), 'og:url')).toBe(
        `${PUBLIC_URL}/episode/12-anything`,
      );
    });
  });

  describe('a clip that does not exist', () => {
    it('serves the generic tags with a 200 and lets the SPA render the 404', async () => {
      const response = await request(app.getHttpServer()).get('/9999').expect(200);
      const head = parseHead(response.text);

      // ⚠️ Not a 404 and not a redirect: whether `/9999` is an error page is the
      // SPA's decision, and the shell must not take it away.
      expect(response.status).toBe(200);
      expect(response.headers.location).toBeUndefined();
      expect(head.title).toBe('Índice gravinero');
      expect(metaContent(head, 'og:title')).toBe('Índice gravinero');
      expect(metaContent(head, 'og:image')).toBe('https://gravina82.com/generic-cover.jpg');
    });

    it('does the same for a missing episode', async () => {
      const response = await request(app.getHttpServer()).get('/episode/9999-nada').expect(200);

      expect(parseHead(response.text).title).toBe('Índice gravinero');
    });
  });

  describe('the history-mode fallback', () => {
    it('answers unknown deep links with index.html', async () => {
      for (const path of ['/about', '/episodes', '/creator/12-algo', '/anything/at/all']) {
        const response = await request(app.getHttpServer()).get(path).expect(200);

        expect(response.type).toBe('text/html');
        expect(response.text).toContain('<div id="app"></div>');
        // Untouched: no clip, no episode, so the build's own generic tags.
        expect(parseHead(response.text).title).toBe('Índice gravinero');
      }
    });

    it('serves the root through the same path, not as a raw static file', async () => {
      await request(app.getHttpServer()).get('/').expect(200).expect('Content-Type', /html/);
    });

    it('serves real build files instead of the shell', async () => {
      const response = await request(app.getHttpServer()).get('/assets/app-abc123.js').expect(200);

      expect(response.text).toContain("console.log('gravindex')");
      expect(response.text).not.toContain('<div id="app">');
    });

    it('404s a missing asset rather than handing back HTML', async () => {
      const response = await request(app.getHttpServer()).get('/favicon.ico').expect(404);

      expect(response.text).not.toContain('<div id="app">');
    });

    it('ignores anything that is not a GET', async () => {
      await request(app.getHttpServer()).post('/42').expect(404);
    });
  });

  describe('the API underneath', () => {
    it('still answers under its prefix', async () => {
      const response = await request(app.getHttpServer()).get('/api/health').expect(200);

      expect(response.body.status).toBe('ok');
    });

    it('does not swallow an unknown /api path into the shell', async () => {
      const response = await request(app.getHttpServer()).get('/api/nope').expect(404);

      expect(response.type).toBe('application/json');
      expect(response.text).not.toContain('<div id="app">');
    });
  });
});

describe('SPA shell with no build on disk', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // ⚠️ No frontend build is a NORMAL state of a dev checkout, and it must not
    // stop the API from working.
    app = await createApp(
      resolve(__dirname, '__fixtures__/does-not-exist'),
      createEntityManagerStub([], []),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('boots and keeps the API answering', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200);
  });

  it('404s the SPA paths instead of crashing', async () => {
    await request(app.getHttpServer()).get('/42').expect(404);
    await request(app.getHttpServer()).get('/about').expect(404);
  });
});
