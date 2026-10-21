import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { WaveformService } from '../waveform/waveform.service';
import { IngestService } from './ingest.service';

// The only thing that triggers ingestion — and, chained after it, the
// waveform top-up — in the running application.
//
// ⚠️ Registered imperatively through `SchedulerRegistry` rather than with a
// `@Cron('…')` decorator, and that is not a style preference: a decorator
// argument is evaluated when the module file is IMPORTED, which happens before
// `ConfigModule.forRoot()` has read any `.env` file. A decorated schedule can
// therefore only ever be a hard-coded constant. This one is configuration.
//
// `ScheduleModule.forRoot()` lives in `AppModule` (it is global), so nothing
// here has to import it.

// Once a day, 05:00 in the configured zone. The podcast publishes weekly, so
// this is already an order of magnitude more often than it needs to be — and
// each run is exactly one HTTP request.
export const DEFAULT_CRON = '0 5 * * *';
export const DEFAULT_TIMEZONE = 'UTC';
export const INGEST_JOB_NAME = 'ingest-episodes';

// ⚠️ Deliberately small. A newly ingested batch can be large (see the backend
// AGENTS.md, "Ingestion"), and downloading + decoding all of them in the first nightly
// tick after that would turn one cron run into hours of outbound traffic to a
// third party's server. `waveform.cli.ts --limit` is the tool for a deliberate
// bulk catch-up; this is just the trickle that keeps new episodes from
// falling behind forever.
export const DEFAULT_WAVEFORM_MAX_PER_RUN = 5;

// Any of these as `INGEST_CRON` or `WAVEFORM_ENABLED` turns the respective job
// off entirely, which is what local development usually wants: nobody needs a
// nightly scrape — or ffmpeg run — against a throwaway database.
const DISABLED = new Set(['', 'off', 'false', 'no', 'disabled', '0']);

@Injectable()
export class IngestScheduler implements OnModuleInit {
  private readonly logger = new Logger(IngestScheduler.name);

  constructor(
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
    private readonly ingest: IngestService,
    private readonly waveforms: WaveformService,
  ) {}

  private get waveformsEnabled(): boolean {
    const value = (this.config.get<string>('WAVEFORM_ENABLED') ?? 'true').trim().toLowerCase();
    return !DISABLED.has(value);
  }

  private get waveformMaxPerRun(): number {
    const raw = Number(this.config.get<string>('WAVEFORM_MAX_PER_RUN'));
    return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_WAVEFORM_MAX_PER_RUN;
  }

  // ⚠️ Never rejects: both `IngestService.run` and `WaveformService.
  // processPending` are contractually non-rejecting, and this composes the
  // two without adding a way for the pair to reject that neither half has on
  // its own.
  private async runIngestAndWaveforms(): Promise<void> {
    await this.ingest.run();

    if (!this.waveformsEnabled) {
      return;
    }
    await this.waveforms.processPending({ max: this.waveformMaxPerRun });
  }

  onModuleInit(): void {
    const expression = (this.config.get<string>('INGEST_CRON') ?? DEFAULT_CRON).trim();
    if (DISABLED.has(expression.toLowerCase())) {
      this.logger.log('INGEST_CRON is off — episode ingestion will not run on a schedule');
      return;
    }

    const timeZone = (this.config.get<string>('INGEST_TIMEZONE') ?? DEFAULT_TIMEZONE).trim();

    try {
      const job = CronJob.from({
        cronTime: expression,
        timeZone,
        // ⚠️ `void`, not `await`: the tick signature is synchronous and
        // `runIngestAndWaveforms` is contractually non-rejecting, so there is
        // nothing here that could become an unhandled rejection.
        onTick: () => void this.runIngestAndWaveforms(),
        // Belt and braces with `IngestService`'s own re-entrancy guard: cron
        // will not even fire a tick while the previous one is still running.
        waitForCompletion: true,
        start: false,
      });

      this.registry.addCronJob(INGEST_JOB_NAME, job);
      job.start();
      this.logger.log(
        `episode ingestion scheduled: "${expression}" (${timeZone}), from ${this.ingest.feedUrl}` +
          (this.waveformsEnabled
            ? `, waveforms chained after it (max ${this.waveformMaxPerRun}/run)`
            : ', waveforms disabled'),
      );
    } catch (cause) {
      // ⚠️ A typo in `INGEST_CRON` must not stop the site from booting — but it
      // must not disappear either, which is why this is an error-level log and
      // not a warning. Ingestion is simply off until the value is fixed.
      this.logger.error(
        `INGEST_CRON is not a valid cron expression ("${expression}"), ingestion is DISABLED: ` +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    }
  }
}
