import { cpus } from 'node:os';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { DatabaseModule } from '../database/database.module';
import { Episode } from '../database/entities/Episode.entity';
import { fileExists } from './episode-download';
import { EPISODES_DIR } from './waveform.constants';
import { WaveformModule } from './waveform.module';
import { EpisodeToProcess, ProcessResult, WaveformService } from './waveform.service';

/**
 * The initial backfill: measure every episode's waveform once, in one run.
 *
 *     npm run build
 *     node dist/waveform/waveform.cli.js [flags]
 *
 * Idempotent like `download-episodes.ts`: without `--force`, an episode that
 * already has a waveform is skipped, so a Ctrl-C or a crash costs nothing —
 * re-running only measures what is still missing.
 *
 * Flags:
 *   --concurrency N   how many LOCAL analyses (ffmpeg on a file already on
 *                      disk) run at once. Default: CPU count minus one.
 *                      ⚠️ Downloads for episodes not yet on disk are NEVER
 *                      concurrent — one at a time, on their own lane, the
 *                      same politeness rule `download-episodes.ts` and
 *                      `FeedClient` follow: gravina82.com is a third party's
 *                      server.
 *   --force           recompute even episodes that already have a waveform.
 *   --limit N         stop after N episodes (applied after --ids/--force).
 *   --ids 1,2,3       only these episode ids, regardless of --force.
 *   --delete-audio    delete an episode's mp3 after a successful measurement
 *                      — but only one that was already on disk before this
 *                      run; a fresh download made for this run is always
 *                      deleted, flag or not (see `WaveformService`).
 */

@Module({
  imports: [
    ConfigModule.forRoot({
      // Mirrors AppModule's list — see the comment there for why real
      // environment variables win over the files.
      envFilePath: [`.env.${process.env.NODE_ENV}`, '.env', '../../.env'],
      isGlobal: true,
    }),
    DatabaseModule,
    WaveformModule,
  ],
})
class WaveformCliModule {}

interface Flags {
  concurrency: number;
  force: boolean;
  limit: number | null;
  ids: number[] | null;
  deleteAudio: boolean;
}

const USAGE =
  'Usage: node dist/waveform/waveform.cli.js ' +
  '[--concurrency N] [--force] [--limit N] [--ids 1,2,3] [--delete-audio]';

function defaultConcurrency(): number {
  return Math.max(1, (cpus().length || 2) - 1);
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {
    concurrency: defaultConcurrency(),
    force: false,
    limit: null,
    ids: null,
    deleteAudio: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--force':
        flags.force = true;
        break;
      case '--delete-audio':
        flags.deleteAudio = true;
        break;
      case '--concurrency': {
        const value = Number(argv[++i]);
        if (!Number.isInteger(value) || value < 1) {
          throw new Error(`--concurrency needs a positive integer\n\n${USAGE}`);
        }
        flags.concurrency = value;
        break;
      }
      case '--limit': {
        const value = Number(argv[++i]);
        if (!Number.isInteger(value) || value < 1) {
          throw new Error(`--limit needs a positive integer\n\n${USAGE}`);
        }
        flags.limit = value;
        break;
      }
      case '--ids': {
        const raw = argv[++i] ?? '';
        const ids = raw
          .split(',')
          .map((part) => Number(part.trim()))
          .filter((id) => Number.isInteger(id) && id > 0);
        if (ids.length === 0) {
          throw new Error(`--ids needs a comma-separated list of positive integers\n\n${USAGE}`);
        }
        flags.ids = ids;
        break;
      }
      default:
        throw new Error(`Unknown option "${arg}"\n\n${USAGE}`);
    }
  }

  return flags;
}

async function candidates(em: EntityManager, flags: Flags): Promise<EpisodeToProcess[]> {
  const where =
    flags.ids !== null ? { id: { $in: flags.ids } } : flags.force ? {} : { waveform: null };

  const rows = await em.find(Episode, where, {
    orderBy: { id: 'asc' },
    fields: ['id', 'file'],
  });

  const all = rows.map((row): EpisodeToProcess => ({ id: row.id, file: row.file }));
  return flags.limit === null ? all : all.slice(0, flags.limit);
}

/** Splits candidates into "already on disk" (safe to run concurrently) and
 *  "needs a download first" (must stay on the serial, polite lane). */
async function splitByLocality(
  episodes: EpisodeToProcess[],
): Promise<{ local: EpisodeToProcess[]; remote: EpisodeToProcess[] }> {
  const local: EpisodeToProcess[] = [];
  const remote: EpisodeToProcess[] = [];

  for (const episode of episodes) {
    const destination = `${EPISODES_DIR}/${episode.id}.mp3`;

    // catalogue is ~600 rows; a `stat` per row costs nothing next to the
    // audio work about to follow, and a Promise.all here would fire ~600
    // filesystem calls at once for no benefit.
    if (await fileExists(destination)) {
      local.push(episode);
    } else {
      remote.push(episode);
    }
  }

  return { local, remote };
}

async function runPool(
  episodes: EpisodeToProcess[],
  concurrency: number,
  process: (episode: EpisodeToProcess) => Promise<ProcessResult>,
  onResult: (result: ProcessResult, index: number, total: number) => void,
): Promise<void> {
  let cursor = 0;
  const total = episodes.length;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const episode = episodes[index];
      if (episode === undefined) {
        return;
      }
      const result = await process(episode);
      onResult(result, index, total);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, episodes.length)) }, () => worker()),
  );
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));

  const app = await NestFactory.createApplicationContext(WaveformCliModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    // ⚠️ A fork, not the injected instance — there is no request context in a
    // one-shot CLI, and `allowGlobalContext` is off (`mikro-orm.config.ts`).
    const em = app.get(EntityManager).fork();
    const waveforms = app.get(WaveformService);

    const all = await candidates(em, flags);
    console.log(`candidates ${all.length}`);
    if (all.length === 0) {
      return;
    }

    const { local, remote } = await splitByLocality(all);
    console.log(`local       ${local.length} (up to ${flags.concurrency} at a time)`);
    console.log(`to download ${remote.length} (one at a time)`);
    console.log('');

    let measured = 0;
    let failed = 0;
    const failures: ProcessResult[] = [];
    let done = 0;

    const report = (result: ProcessResult): void => {
      done += 1;
      if (result.status === 'measured') {
        measured += 1;
        console.log(`[${done}/${all.length}] episode ${result.id} — ${result.seconds}s`);
      } else {
        failed += 1;
        failures.push(result);
        console.error(`[${done}/${all.length}] episode ${result.id} — FAILED: ${result.error}`);
      }
    };

    const processOptions = { deleteAudioAfter: flags.deleteAudio };

    // The download lane runs FIRST and serially — the same politeness rule as
    // `download-episodes.ts`. The local-analysis lane runs concurrently
    // afterwards, since it touches only the local disk and ffmpeg.
    for (const episode of remote) {
      const result = await waveforms.processEpisode(episode, processOptions);
      report(result);
    }

    await runPool(
      local,
      flags.concurrency,
      (episode) => waveforms.processEpisode(episode, processOptions),
      (result) => report(result),
    );

    console.log('');
    console.log(`measured ${measured} · failed ${failed}`);

    if (failures.length > 0) {
      console.log('');
      console.log('Failed episodes (re-run the script to retry — measured ones are skipped):');
      for (const failure of failures) {
        console.log(`  ${failure.id}: ${failure.error}`);
      }
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
