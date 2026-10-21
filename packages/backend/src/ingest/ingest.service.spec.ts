import { EntityManager } from '@mikro-orm/postgresql';
import { ConfigService } from '@nestjs/config';
import { Episode } from '../database/entities/Episode.entity';
import { FIXTURE_FACTS, readFeedFixture, truncatedFeedFixture } from './__fixtures__/feed-fixture';
import { FeedClient } from './feed-client';
import { DEFAULT_FEED_URL, DEFAULT_TIMEOUT_MS, IngestService } from './ingest.service';

// ⚠️ No network and no database here: the feed comes from the saved fixture and
// the EntityManager is a stub. What this file guards is the JOB's behaviour —
// what it asks for, what it counts, and above all that it never throws at its
// caller, because its caller is a cron tick with nobody to catch it.
// Persistence itself is tested against real Postgres in
// `ingest.persistence.spec.ts`.

// The narrowest EntityManager that `ingestXml` actually exercises. Cast once,
// here, so no test has to.
function stubEntityManager(existing: Episode[] = []): { em: EntityManager; persisted: Episode[] } {
  const persisted: Episode[] = [];
  const forked = {
    find: () => Promise.resolve(existing),
    create: (_entity: unknown, data: Partial<Episode>) => data as Episode,
    persist: (episode: Episode) => persisted.push(episode),
    flush: () => Promise.resolve(),
  };
  return { em: { fork: () => forked } as unknown as EntityManager, persisted };
}

function stubFeedClient(fetchFeed: FeedClient['fetchFeed']): FeedClient {
  return { fetchFeed } as FeedClient;
}

// ⚠️ `ConfigService.get` consults `process.env` BEFORE the object handed to its
// constructor, so an ambient `INGEST_*` would quietly win over anything a test
// sets. Clearing them is what makes "the defaults" mean the defaults.
beforeEach(() => {
  delete process.env.INGEST_FEED_URL;
  delete process.env.INGEST_TIMEOUT_MS;
});

describe('IngestService.run', () => {
  it('requests the default feed with a timeout, and reports what it ingested', async () => {
    const calls: [string, number][] = [];
    const { em, persisted } = stubEntityManager();
    const service = new IngestService(
      em,
      new ConfigService({}),
      stubFeedClient((url, timeoutMs) => {
        calls.push([url, timeoutMs]);
        return Promise.resolve(readFeedFixture());
      }),
    );

    const summary = await service.run();

    expect(calls).toEqual([[DEFAULT_FEED_URL, DEFAULT_TIMEOUT_MS]]);
    expect(summary).toEqual({
      entries: FIXTURE_FACTS.totalEntries,
      withoutAudio: FIXTURE_FACTS.withoutAudio,
      malformed: FIXTURE_FACTS.malformed,
      duplicateLinks: 0,
      inserted: FIXTURE_FACTS.audioEntries,
      alreadyPresent: 0,
      durationsBackfilled: 0,
    });
    expect(persisted).toHaveLength(FIXTURE_FACTS.audioEntries);
  });

  it('lets configuration move the feed URL and the timeout', async () => {
    process.env.INGEST_FEED_URL = 'https://example.invalid/rss';
    process.env.INGEST_TIMEOUT_MS = '750';
    const calls: [string, number][] = [];
    const service = new IngestService(
      stubEntityManager().em,
      new ConfigService({}),
      stubFeedClient((url, timeoutMs) => {
        calls.push([url, timeoutMs]);
        return Promise.resolve('<rss version="2.0"><channel /></rss>');
      }),
    );

    await service.run();

    expect(calls).toEqual([['https://example.invalid/rss', 750]]);
  });

  // ⚠️ The contract the whole design leans on: a cron tick has nobody to catch
  // a rejection, and an unhandled one kills the process that is also serving
  // the site.
  it.each([
    ['the feed is unreachable', () => Promise.reject(new Error('getaddrinfo ENOTFOUND'))],
    ['the feed answers with an error page', () => Promise.resolve('<html>502</html>')],
    ['the response is truncated', () => Promise.resolve(truncatedFeedFixture())],
  ])('reports an error instead of rejecting when %s', async (_case, fetchFeed) => {
    const service = new IngestService(
      stubEntityManager().em,
      new ConfigService({}),
      stubFeedClient(fetchFeed),
    );

    const summary = await service.run();

    expect(summary.error).toEqual(expect.any(String));
    expect(summary.inserted).toBe(0);
  });

  // Two ticks overlapping would double-insert everything the first one has not
  // flushed yet.
  it('refuses to start a second run while one is in flight', async () => {
    let release: (xml: string) => void = () => undefined;
    const inFlight = new Promise<string>((resolve) => {
      release = resolve;
    });
    const service = new IngestService(
      stubEntityManager().em,
      new ConfigService({}),
      stubFeedClient(() => inFlight),
    );

    const first = service.run();
    const second = await service.run();
    release('<rss version="2.0"><channel /></rss>');

    expect(second.error).toBe('already running');
    expect((await first).error).toBeUndefined();
  });
});

describe('IngestService.ingestXml', () => {
  const xml = readFeedFixture();

  // The dedup key. It is `link` and not the mp3 URL precisely because the stored
  // rows keep `link` in `originalUrl` — change it and the
  // first run re-imports the entire back catalogue.
  it('inserts nothing for entries whose link is already stored', async () => {
    const alreadyStored = Object.assign(new Episode(), {
      id: 1,
      title: 'ya estaba',
      originalUrl: FIXTURE_FACTS.newest.originalUrl,
      duration: 4758,
    });
    const { em, persisted } = stubEntityManager([alreadyStored]);
    const service = new IngestService(
      em,
      new ConfigService({}),
      stubFeedClient(() => Promise.resolve(xml)),
    );

    const summary = await service.ingestXml(xml);

    expect(summary.alreadyPresent).toBe(1);
    expect(summary.inserted).toBe(FIXTURE_FACTS.audioEntries - 1);
    expect(persisted.some((episode) => episode.originalUrl === alreadyStored.originalUrl)).toBe(
      false,
    );
  });

  // ⚠️ The one field ingestion writes on a row that already exists.
  it('backfills a missing duration without touching anything else', async () => {
    const stored = Object.assign(new Episode(), {
      id: 1,
      title: 'título corregido a mano',
      cover: 'https://example.com/earlier-import/portada-propia.png',
      originalUrl: FIXTURE_FACTS.newest.originalUrl,
    });
    const service = new IngestService(
      stubEntityManager([stored]).em,
      new ConfigService({}),
      stubFeedClient(() => Promise.resolve(xml)),
    );

    const summary = await service.ingestXml(xml);

    expect(summary.durationsBackfilled).toBe(1);
    expect(stored.duration).toBe(4758);
    expect(stored.title).toBe('título corregido a mano');
    expect(stored.cover).toBe('https://example.com/earlier-import/portada-propia.png');
  });

  it('leaves a duration that is already stored alone', async () => {
    const stored = Object.assign(new Episode(), {
      id: 1,
      originalUrl: FIXTURE_FACTS.newest.originalUrl,
      duration: 1,
    });
    const service = new IngestService(
      stubEntityManager([stored]).em,
      new ConfigService({}),
      stubFeedClient(() => Promise.resolve(xml)),
    );

    const summary = await service.ingestXml(xml);

    expect(summary.durationsBackfilled).toBe(0);
    expect(stored.duration).toBe(1);
  });

  // A feed that repeats a link would otherwise insert the same episode twice in
  // a single run — the database dedup cannot help, the rows are not there yet.
  it('imports a link repeated inside one document exactly once', async () => {
    const entry =
      '<item><title>x</title><link>https://example.invalid/e/</link>' +
      '<pubDate>Wed, 29 Jul 2026 18:27:27 +0000</pubDate>' +
      '<enclosure url="https://example.invalid/a.mp3" length="1" type="audio/mpeg" /></item>';
    const { em, persisted } = stubEntityManager();
    const service = new IngestService(
      em,
      new ConfigService({}),
      stubFeedClient(() => Promise.resolve('')),
    );

    const summary = await service.ingestXml(
      `<rss version="2.0"><channel>${entry}${entry}</channel></rss>`,
    );

    expect(summary).toMatchObject({ entries: 2, inserted: 1, duplicateLinks: 1 });
    expect(persisted).toHaveLength(1);
  });

  // New rows can only get the channel artwork — the feed has nothing else.
  it('gives every new episode the channel cover', async () => {
    const { em, persisted } = stubEntityManager();
    const service = new IngestService(
      em,
      new ConfigService({}),
      stubFeedClient(() => Promise.resolve(xml)),
    );

    await service.ingestXml(xml);

    expect(new Set(persisted.map((episode) => episode.cover))).toEqual(
      new Set([FIXTURE_FACTS.cover]),
    );
  });
});
