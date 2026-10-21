import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../database/database.module';
import { WaveformModule } from '../waveform/waveform.module';
import { WaveformService } from '../waveform/waveform.service';
import { DEFAULT_WAVEFORM_MAX_PER_RUN } from './ingest.scheduler';
import { IngestModule } from './ingest.module';
import { IngestService } from './ingest.service';

// Runs episode ingestion exactly once — chained by a capped waveform top-up,
// same as `IngestScheduler`'s nightly tick — and exits. This is the manual
// entry point: same job as the scheduled one, reachable only by someone with a
// shell on the machine instead of by anyone on the internet.
//
//     npm run build
//     node dist/ingest/ingest.cli.js [--skip-waveforms]
//
// It reads the same `.env` as the server, so it needs `DB_HOST`, `DB_PORT`,
// `DB_USER`, `DB_PASSWORD` and `DB_NAME` to be set exactly as `npm run dev`
// does. Prints the run summary as JSON and exits non-zero if the run failed,
// so it composes with a shell.
//
// ⚠️ The waveform step is capped the same way the scheduler caps it
// (`WAVEFORM_MAX_PER_RUN`, `WAVEFORM_ENABLED`) — this is the manual equivalent
// of one cron tick, not a bulk backfill. A deliberate catch-up after a large
// ingest (the feed can bring over a hundred new episodes at once — root
// CLAUDE.md, "Ingestion") is `waveform.cli.ts`'s job: it downloads
// concurrently and resumes, which this one-shot command does not.

// ⚠️ Set BEFORE the context is created, and it is why this line is not just
// tidiness: `@nestjs/config` never overwrites an existing environment variable,
// so this wins over whatever `.env` says and `IngestScheduler` registers no
// cron job at all. A one-shot process has no business installing a timer.
process.env.INGEST_CRON = 'off';

@Module({
  imports: [
    ConfigModule.forRoot({
      // Mirrors AppModule's list — see the comment there for why real
      // environment variables win over the files.
      envFilePath: [`.env.${process.env.NODE_ENV}`, '.env', '../../.env'],
      isGlobal: true,
    }),
    // `IngestScheduler` injects `SchedulerRegistry`, so the module that
    // provides it has to be present even though the job above is disabled.
    ScheduleModule.forRoot(),
    DatabaseModule,
    IngestModule,
    WaveformModule,
  ],
})
class IngestCliModule {}

const WAVEFORM_DISABLED = new Set(['', 'off', 'false', 'no', 'disabled', '0']);

async function main(): Promise<void> {
  const skipWaveforms = process.argv.includes('--skip-waveforms');

  const app = await NestFactory.createApplicationContext(IngestCliModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const summary = await app.get(IngestService).run();
    console.log(JSON.stringify(summary, null, 2));
    if (summary.error) {
      process.exitCode = 1;
    }

    if (skipWaveforms) {
      return;
    }
    const config = app.get(ConfigService);
    const enabled = !WAVEFORM_DISABLED.has(
      (config.get<string>('WAVEFORM_ENABLED') ?? 'true').trim().toLowerCase(),
    );
    if (!enabled) {
      return;
    }
    const rawMax = Number(config.get<string>('WAVEFORM_MAX_PER_RUN'));
    const max = Number.isInteger(rawMax) && rawMax > 0 ? rawMax : DEFAULT_WAVEFORM_MAX_PER_RUN;

    const waveformSummary = await app.get(WaveformService).processPending({ max });
    console.log(JSON.stringify(waveformSummary, null, 2));
    if (waveformSummary.error) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

void main();
