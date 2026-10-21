import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { MikroORM } from '@mikro-orm/postgresql';
import { buildMikroOrmOptions } from '../mikro-orm.config';
import { Episode } from '../database/entities/Episode.entity';
import { cleanupPartialDownload, downloadOne, fileExists } from '../waveform/episode-download';
import { EPISODES_DIR as OUTPUT_DIR } from '../waveform/waveform.constants';

/**
 * Downloads every episode's mp3 into a local, gitignored folder, so the
 * waveform backfill (`waveform.cli.ts`) and any future offline process has the
 * audio on disk instead of refetching it from gravina82.com every time it
 * needs to look at one.
 *
 *     npm run build && npm run download-episodes -w packages/backend
 *
 * ⚠️ Sequential ON PURPOSE, one request at a time, never parallel — the same
 * politeness rule `FeedClient` follows: gravina82.com is a third party's
 * server, and this fetches several hundred files in one run.
 *
 * Idempotent and resumable: an episode already present at its final path is
 * skipped, so re-running after a crash or a Ctrl-C only fetches what is
 * missing. Each download lands at `<id>.mp3.part` first and is renamed into
 * place only once it finishes, so a partial file left by an interrupted run is
 * never mistaken for a complete one.
 *
 * Flags:
 *   --force   redownload episodes that are already on disk
 */

const USAGE = `Usage: node dist/scripts/download-episodes.js [--force]`;

interface DownloadFailure {
  id: number;
  error: string;
}

async function main(): Promise<void> {
  const flags = new Set(process.argv.slice(2));
  const unknown = [...flags].filter((flag) => flag !== '--force');
  if (unknown.length > 0) {
    console.error(`Unknown option(s): ${unknown.join(', ')}\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }
  const force = flags.has('--force');

  await mkdir(OUTPUT_DIR, { recursive: true });

  const orm = await MikroORM.init(buildMikroOrmOptions());
  try {
    const episodes = await orm.em.fork().find(Episode, {}, { orderBy: { id: 'asc' } });

    console.log(`episodes  ${episodes.length}`);
    console.log(`output    ${OUTPUT_DIR}`);
    console.log('');

    const failed: DownloadFailure[] = [];
    let downloaded = 0;
    let skipped = 0;

    for (const [index, episode] of episodes.entries()) {
      const destination = join(OUTPUT_DIR, `${episode.id}.mp3`);
      const progress = `[${index + 1}/${episodes.length}]`;

      if (!force && (await fileExists(destination))) {
        skipped += 1;
        console.log(`${progress} episode ${episode.id} — already on disk, skipped`);
        continue;
      }

      try {
        const size = await downloadOne(episode.file, destination);
        downloaded += 1;
        console.log(`${progress} episode ${episode.id} — ${(size / (1024 * 1024)).toFixed(1)} MiB`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push({ id: episode.id, error: message });
        console.error(`${progress} episode ${episode.id} — FAILED: ${message}`);
        await cleanupPartialDownload(destination);
      }
    }

    console.log('');
    console.log(`downloaded ${downloaded} · skipped ${skipped} · failed ${failed.length}`);

    if (failed.length > 0) {
      console.log('');
      console.log('Failed episodes (re-run the script to retry — completed ones are skipped):');
      for (const failure of failed) {
        console.log(`  ${failure.id}: ${failure.error}`);
      }
      process.exitCode = 1;
    }
  } finally {
    await orm.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
