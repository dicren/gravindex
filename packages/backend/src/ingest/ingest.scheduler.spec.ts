import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { WaveformService, WaveformSummary } from '../waveform/waveform.service';
import {
  DEFAULT_CRON,
  DEFAULT_WAVEFORM_MAX_PER_RUN,
  INGEST_JOB_NAME,
  IngestScheduler,
} from './ingest.scheduler';
import { IngestService, IngestSummary } from './ingest.service';

// ⚠️ The scheduler is the ONLY thing that triggers ingestion — and, chained
// after it, the waveform top-up — in the running application. "Is a job
// actually registered, and does it chain the second one?" is a question that
// needs an answer in a test rather than in production six months from now.

function stubIngestService(): { service: IngestService; runs: number[] } {
  const runs: number[] = [];
  const service = {
    feedUrl: 'https://example.invalid/rss',
    run: () => {
      runs.push(Date.now());
      return Promise.resolve({} as IngestSummary);
    },
  } as IngestService;
  return { service, runs };
}

function stubWaveformService(): { service: WaveformService; calls: Array<{ max: number }> } {
  const calls: Array<{ max: number }> = [];
  const service = {
    processPending: (options: { max: number }) => {
      calls.push({ max: options.max });
      return Promise.resolve({
        candidates: 0,
        measured: 0,
        failed: 0,
        errors: [],
      } as WaveformSummary);
    },
  } as WaveformService;
  return { service, calls };
}

describe('IngestScheduler', () => {
  let registry: SchedulerRegistry;

  beforeEach(() => {
    delete process.env.INGEST_CRON;
    delete process.env.INGEST_TIMEZONE;
    delete process.env.WAVEFORM_ENABLED;
    delete process.env.WAVEFORM_MAX_PER_RUN;
    registry = new SchedulerRegistry();
  });

  // ⚠️ Without this jest hangs: a started CronJob holds a live timer.
  afterEach(() => {
    for (const [name, job] of registry.getCronJobs()) {
      void job.stop();
      registry.deleteCronJob(name);
    }
  });

  function schedule(waveforms = stubWaveformService()): IngestScheduler {
    const { service } = stubIngestService();
    const scheduler = new IngestScheduler(
      new ConfigService({}),
      registry,
      service,
      waveforms.service,
    );
    scheduler.onModuleInit();
    return scheduler;
  }

  it('registers a running daily job by default', () => {
    schedule();
    const job = registry.getCronJob(INGEST_JOB_NAME);

    expect(job.isActive).toBe(true);
    expect(job.cronTime.source).toBe(DEFAULT_CRON);
  });

  it('takes the expression and the time zone from configuration', () => {
    process.env.INGEST_CRON = '30 4 * * 1';
    process.env.INGEST_TIMEZONE = 'Europe/Madrid';

    schedule();

    expect(registry.getCronJob(INGEST_JOB_NAME).cronTime.source).toBe('30 4 * * 1');
  });

  // Local development does not want a nightly scrape against a throwaway
  // database.
  it.each(['off', 'false', 'no', '0', '', '  '])(
    'registers nothing when INGEST_CRON is %p',
    (value) => {
      process.env.INGEST_CRON = value;

      schedule();

      expect(registry.getCronJobs().size).toBe(0);
    },
  );

  // ⚠️ A typo in an environment variable must not stop the application from
  // booting: the site keeps serving, ingestion is simply off until it is fixed.
  it('survives an invalid cron expression instead of taking the app down', () => {
    process.env.INGEST_CRON = 'todos los martes';

    expect(() => schedule()).not.toThrow();
    expect(registry.getCronJobs().size).toBe(0);
  });

  it('runs an ingestion when the job ticks', async () => {
    const { service, runs } = stubIngestService();
    const { service: waveformService } = stubWaveformService();
    new IngestScheduler(new ConfigService({}), registry, service, waveformService).onModuleInit();

    await registry.getCronJob(INGEST_JOB_NAME).fireOnTick();

    expect(runs).toHaveLength(1);
  });

  describe('the waveform top-up chained after ingestion', () => {
    it('runs after every tick, capped at DEFAULT_WAVEFORM_MAX_PER_RUN by default', async () => {
      const waveforms = stubWaveformService();
      schedule(waveforms);

      await registry.getCronJob(INGEST_JOB_NAME).fireOnTick();

      expect(waveforms.calls).toEqual([{ max: DEFAULT_WAVEFORM_MAX_PER_RUN }]);
    });

    it('respects WAVEFORM_MAX_PER_RUN', async () => {
      process.env.WAVEFORM_MAX_PER_RUN = '20';
      const waveforms = stubWaveformService();
      schedule(waveforms);

      await registry.getCronJob(INGEST_JOB_NAME).fireOnTick();

      expect(waveforms.calls).toEqual([{ max: 20 }]);
    });

    // The same disabled-value vocabulary as INGEST_CRON — see the root
    // CLAUDE.md.
    it.each(['off', 'false', 'no', '0', ''])(
      'never runs when WAVEFORM_ENABLED is %p, but ingestion still does',
      async (value) => {
        process.env.WAVEFORM_ENABLED = value;
        const { service, runs } = stubIngestService();
        const waveforms = stubWaveformService();
        new IngestScheduler(
          new ConfigService({}),
          registry,
          service,
          waveforms.service,
        ).onModuleInit();

        await registry.getCronJob(INGEST_JOB_NAME).fireOnTick();

        expect(runs).toHaveLength(1);
        expect(waveforms.calls).toHaveLength(0);
      },
    );
  });
});
