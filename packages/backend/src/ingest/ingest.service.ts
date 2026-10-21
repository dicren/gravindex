import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Episode } from '../database/entities/Episode.entity';
import { FeedClient } from './feed-client';
import { parseFeed } from './feed-parser';

// Episode ingestion, driven by the podcast's RSS feed — see the backend
// CLAUDE.md, "Ingestion".
//
// ⚠️ This class has NO HTTP surface and must never grow one: an endpoint here
// would be an unauthenticated GET that fires outbound requests and writes to the
// database. Ingestion runs from `IngestScheduler` (a cron job) or from
// `ingest.cli.ts` (a human, locally), and from nothing else.

export const DEFAULT_FEED_URL = 'https://gravina82.com/feed/';
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface IngestSummary {
  // Every `<item>` in the feed, audio or not.
  entries: number;
  // Items with no `<enclosure>`: ordinary blog posts. Skipped by design.
  withoutAudio: number;
  // Items with audio but missing a title, a link or a usable date.
  malformed: number;
  // Items that repeat a `<link>` already seen earlier in the same document.
  duplicateLinks: number;
  // Rows written.
  inserted: number;
  // Entries whose `<link>` already existed as an `originalUrl`.
  alreadyPresent: number;
  // Existing rows that had no duration and got one from the feed.
  durationsBackfilled: number;
  // Present only when the run failed. ⚠️ A scheduled job never throws at its
  // caller; it reports.
  error?: string;
}

const EMPTY_SUMMARY: IngestSummary = {
  entries: 0,
  withoutAudio: 0,
  malformed: 0,
  duplicateLinks: 0,
  inserted: 0,
  alreadyPresent: 0,
  durationsBackfilled: 0,
};

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  // ⚠️ Guards against a run still going when the next tick fires. The cron job
  // also asks for `waitForCompletion`, but the CLI and a future manual trigger
  // do not go through cron at all, so the invariant belongs here too.
  private running = false;

  constructor(
    private readonly em: EntityManager,
    private readonly config: ConfigService,
    private readonly feedClient: FeedClient,
  ) {}

  get feedUrl(): string {
    return this.config.get<string>('INGEST_FEED_URL') ?? DEFAULT_FEED_URL;
  }

  private get timeoutMs(): number {
    const raw = Number(this.config.get<string>('INGEST_TIMEOUT_MS'));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
  }

  // Fetch, parse, persist. ⚠️ Never rejects: an unhandled rejection inside a
  // cron tick takes the process down, and a feed that is briefly unreachable is
  // an ordinary Tuesday, not a reason to stop serving the site.
  async run(): Promise<IngestSummary> {
    if (this.running) {
      this.logger.warn('an ingestion run is already in progress; skipping this one');
      return { ...EMPTY_SUMMARY, error: 'already running' };
    }

    this.running = true;
    const startedAt = Date.now();
    try {
      const xml = await this.feedClient.fetchFeed(this.feedUrl, this.timeoutMs);
      const summary = await this.ingestXml(xml);
      this.logger.log(
        `ingested in ${Date.now() - startedAt}ms: ${summary.inserted} new, ` +
          `${summary.alreadyPresent} already present, ` +
          `${summary.durationsBackfilled} durations backfilled ` +
          `(${summary.entries} entries, ${summary.withoutAudio} without audio)`,
      );
      return summary;
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      this.logger.error(`ingestion failed: ${error}`);
      return { ...EMPTY_SUMMARY, error };
    } finally {
      this.running = false;
    }
  }

  // The half that needs no network, so tests can drive it with the saved
  // fixture. ⚠️ This one DOES throw on unparseable input — `run` is the layer
  // that turns a failure into a summary.
  async ingestXml(xml: string): Promise<IngestSummary> {
    const feed = parseFeed(xml);
    const summary: IngestSummary = {
      ...EMPTY_SUMMARY,
      entries: feed.totalEntries,
      withoutAudio: feed.withoutAudio,
      malformed: feed.malformed,
    };

    // ⚠️ A fork, not the injected EntityManager: there is no request context
    // around a cron tick, and `allowGlobalContext` is off.
    const em = this.em.fork();

    // One round trip for the whole feed. A feed's worth of links is a trivial
    // `IN (…)` at this scale, and the alternative — a `count()` per entry, which
    // would be one round trip per entry.
    const existing = await em.find(Episode, {
      originalUrl: { $in: feed.entries.map((entry) => entry.originalUrl) },
    });
    const byOriginalUrl = new Map(existing.map((episode) => [episode.originalUrl, episode]));

    // ⚠️ Dedup happens twice: against the database (`originalUrl` is the key
    // that makes the stored rows match) AND within the document, because
    // idempotency has to survive a feed that repeats a link to itself.
    const seen = new Set<string>();

    for (const entry of feed.entries) {
      if (seen.has(entry.originalUrl)) {
        summary.duplicateLinks++;
        continue;
      }
      seen.add(entry.originalUrl);

      const found = byOriginalUrl.get(entry.originalUrl);
      if (!found) {
        em.persist(
          em.create(Episode, {
            title: entry.title,
            // ⚠️ The feed has no per-entry image, so every NEW episode gets the
            // channel artwork. Existing rows keep the per-episode cover they
            // already have — see below.
            cover: feed.cover,
            file: entry.file,
            originalUrl: entry.originalUrl,
            date: entry.date,
            description: entry.description,
            ...(entry.duration === null ? {} : { duration: entry.duration }),
          }),
        );
        summary.inserted++;
        continue;
      }

      summary.alreadyPresent++;

      // ⚠️ The ONLY field ingestion ever writes on an existing row. Everything
      // else is left exactly as it is, deliberately:
      //   - `cover` on existing rows is a real per-episode image; the
      //     feed could only replace it with the generic channel logo, which is
      //     strictly worse;
      //   - `title`, `file`, `date` and `description` may have been corrected by
      //     hand in the database, and a nightly job silently reverting that is
      //     the kind of surprise nobody debugs twice.
      // Refreshing any of them is a product decision, not an implementation
      // detail — and it needs its own test for what "unchanged" means.
      if (found.duration === undefined || found.duration === null) {
        if (entry.duration !== null) {
          found.duration = entry.duration;
          summary.durationsBackfilled++;
        }
      }
    }

    await em.flush();
    return summary;
  }
}
