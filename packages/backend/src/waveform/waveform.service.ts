import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Episode } from '../database/entities/Episode.entity';
import { DEFAULT_ANALYZE_TIMEOUT_MS, WaveformAnalyzer } from './waveform-analyzer';
import { EpisodeDownloader } from './episode-download';
import { EPISODES_DIR } from './waveform.constants';
import { buildPendingEpisodesQuery, PendingEpisodeRow } from './waveform.sql';

// Turns "an episode has no waveform yet" into "it does": locate the mp3 (on
// disk already, or a fresh download), measure it, write the two columns it can
// fill in (`waveform`, and `duration` when that was empty too), and clean up
// after itself. `WaveformCli` (the bulk backfill) and `IngestScheduler` (the
// nightly top-up after ingestion) are its only two callers.

const DEFAULT_FFMPEG_PATH = 'ffmpeg';

export interface EpisodeToProcess {
  id: number;
  file: string;
}

export interface ProcessOptions {
  /** Delete the episode's mp3 after a SUCCESSFUL measurement — but only when
   *  it was already on disk; a fresh download made for this run is always
   *  deleted regardless of this flag. Default `false`: `data/episodes/` is
   *  the shared cache the download script and every future run of this
   *  service reuse, and clearing it is a deliberate, separate decision. */
  deleteAudioAfter?: boolean;
  ffmpegPath?: string;
  timeoutMs?: number;
}

export type ProcessStatus = 'measured' | 'failed';

export interface ProcessResult {
  id: number;
  status: ProcessStatus;
  seconds?: number;
  error?: string;
}

export interface WaveformSummary {
  candidates: number;
  measured: number;
  failed: number;
  errors: Array<{ id: number; error: string }>;
  /** Present only when the whole run failed before it could process anything
   *  — the database was unreachable, say. ⚠️ A scheduled job never throws at
   *  its caller; it reports, exactly like `IngestSummary`. */
  error?: string;
}

const EMPTY_SUMMARY: WaveformSummary = { candidates: 0, measured: 0, failed: 0, errors: [] };

@Injectable()
export class WaveformService {
  private readonly logger = new Logger(WaveformService.name);

  // Guards `processPending` against overlapping invocations of the SAME
  // process — the scheduler chaining after ingestion and a supervisor firing
  // two ticks close together, for instance. A separate `waveform.cli.ts` run
  // is a different process and needs no coordination with this one: it only
  // ever touches rows this one has already finished with (`waveform is null`).
  private running = false;

  constructor(
    private readonly em: EntityManager,
    private readonly config: ConfigService,
    private readonly analyzer: WaveformAnalyzer,
    private readonly downloader: EpisodeDownloader,
  ) {}

  private get ffmpegPath(): string {
    return this.config.get<string>('WAVEFORM_FFMPEG_PATH') ?? DEFAULT_FFMPEG_PATH;
  }

  private get timeoutMs(): number {
    const raw = Number(this.config.get<string>('WAVEFORM_TIMEOUT_MS'));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ANALYZE_TIMEOUT_MS;
  }

  /**
   * Measure one episode and write `waveform` (and `duration`, if it had none)
   * to `gravindex-db`. ⚠️ Never rejects — a download or ffmpeg failure comes
   * back as `{ status: 'failed', error }`, so a bad mp3 or a missing `ffmpeg`
   * binary costs one episode, never the run.
   */
  async processEpisode(
    episode: EpisodeToProcess,
    options: ProcessOptions = {},
  ): Promise<ProcessResult> {
    const localPath = join(EPISODES_DIR, `${episode.id}.mp3`);
    const alreadyOnDisk = await this.downloader.exists(localPath);
    const tempPath = alreadyOnDisk
      ? null
      : join(tmpdir(), `gravindex-waveform-${episode.id}-${process.pid}.mp3`);
    const filePath = alreadyOnDisk ? localPath : (tempPath as string);

    try {
      if (tempPath !== null) {
        await this.downloader.download(episode.file, tempPath);
      }

      const analysis = await this.analyzer.analyze(filePath, {
        ffmpegPath: options.ffmpegPath ?? this.ffmpegPath,
        timeoutMs: options.timeoutMs ?? this.timeoutMs,
      });

      await this.persist(episode.id, analysis.peaks, analysis.seconds);

      if (alreadyOnDisk && options.deleteAudioAfter === true) {
        await rm(localPath, { force: true });
      }

      return { id: episode.id, status: 'measured', seconds: analysis.seconds };
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      return { id: episode.id, status: 'failed', error };
    } finally {
      // ⚠️ ALWAYS removed, success or failure — a fresh download is never the
      // shared cache; only a file that was already there before this call
      // (`alreadyOnDisk`) is, and that one is governed by `deleteAudioAfter`
      // above, not by this.
      if (tempPath !== null) {
        await rm(tempPath, { force: true }).catch(() => this.downloader.cleanupPartial(tempPath));
      }
    }
  }

  /**
   * Process up to `max` episodes with no waveform yet, one at a time. The path
   * both `IngestScheduler` (capped low, chained after every ingestion tick)
   * and `waveform.cli.ts` (uncapped, or capped by `--limit`) go through.
   *
   * ⚠️ Never rejects, for the same reason `IngestService.run` does not: an
   * unhandled rejection inside a cron tick takes the whole process down.
   */
  async processPending(options: { max: number } & ProcessOptions): Promise<WaveformSummary> {
    if (this.running) {
      this.logger.warn('a waveform run is already in progress; skipping this one');
      return EMPTY_SUMMARY;
    }

    this.running = true;
    const startedAt = Date.now();
    try {
      const em = this.em.fork();
      const { sql, params } = buildPendingEpisodesQuery(options.max);
      const rows = (await em
        .getConnection()
        .execute(sql, params)) as unknown as PendingEpisodeRow[];

      const summary: WaveformSummary = {
        candidates: rows.length,
        measured: 0,
        failed: 0,
        errors: [],
      };

      for (const row of rows) {
        const result = await this.processEpisode(row, options);
        if (result.status === 'measured') {
          summary.measured++;
        } else {
          summary.failed++;
          summary.errors.push({ id: row.id, error: result.error ?? 'unknown error' });
          this.logger.warn(`episode ${row.id}: waveform failed — ${result.error}`);
        }
      }

      this.logger.log(
        `waveform run in ${Date.now() - startedAt}ms: ${summary.measured} measured, ` +
          `${summary.failed} failed, out of ${summary.candidates} candidates`,
      );
      return summary;
    } catch (cause) {
      // ⚠️ Only reachable if the pending-episodes QUERY itself fails (the
      // database is unreachable, say) — `processEpisode` never throws, so the
      // loop above cannot land here.
      const error = cause instanceof Error ? cause.message : String(cause);
      this.logger.error(`waveform run failed: ${error}`);
      return { ...EMPTY_SUMMARY, error };
    } finally {
      this.running = false;
    }
  }

  // -------------------------------------------------------------- helpers

  private async persist(episodeId: number, peaks: Buffer, measuredSeconds: number): Promise<void> {
    // ⚠️ A fork, not the injected EntityManager — same reasoning as
    // `IngestService.ingestXml`: there is no request context around a cron
    // tick or a CLI run, and `allowGlobalContext` is off.
    const em = this.em.fork();
    const episode = await em.findOne(Episode, { id: episodeId });
    if (episode === null) {
      // Deleted through the admin surface between being listed as pending and
      // being processed. Nothing to write to; not an error.
      return;
    }

    episode.waveform = peaks;
    // ⚠️ The ONLY other field this ever writes, and only when empty — exactly
    // `IngestService`'s backfill rule for the same column. A measured value
    // never overwrites one the feed already supplied.
    if (episode.duration === undefined || episode.duration === null) {
      episode.duration = measuredSeconds;
    }

    await em.flush();
  }
}
