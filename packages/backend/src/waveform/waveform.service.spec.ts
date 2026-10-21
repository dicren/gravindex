import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EntityManager } from '@mikro-orm/postgresql';
import { ConfigService } from '@nestjs/config';
import { Episode } from '../database/entities/Episode.entity';
import { EpisodeDownloader, fileExists } from './episode-download';
import { WaveformAnalyzer } from './waveform-analyzer';
import { EPISODES_DIR } from './waveform.constants';
import { PendingEpisodeRow } from './waveform.sql';
import { WaveformService } from './waveform.service';

// ⚠️ No ffmpeg process, no real network, no real database here: what this file
// guards is the SERVICE's orchestration — what gets called, what gets cleaned
// up, and above all that it never rejects, because its callers are a cron tick
// and a CLI loop with nobody to catch it. The analyzer's own correctness is
// `waveform-analyzer.spec.ts`, against a real ffmpeg and real audio.

function stubAnalyzer(analyze: WaveformAnalyzer['analyze']): WaveformAnalyzer {
  return { analyze } as WaveformAnalyzer;
}

function stubDownloader(overrides: Partial<EpisodeDownloader> = {}): EpisodeDownloader {
  return {
    exists: async () => false,
    download: async () => 0,
    cleanupPartial: async () => undefined,
    ...overrides,
  } as EpisodeDownloader;
}

function stubEntityManager(
  options: {
    pendingRows?: PendingEpisodeRow[];
    episodes?: Map<number, Episode>;
    onQuery?: () => void;
  } = {},
): EntityManager {
  const episodes = options.episodes ?? new Map<number, Episode>();
  const pendingRows = options.pendingRows ?? [];

  const forked = {
    getConnection: () => ({
      execute: () => {
        options.onQuery?.();
        return Promise.resolve(pendingRows);
      },
    }),
    findOne: (_entity: unknown, where: { id: number }) =>
      Promise.resolve(episodes.get(where.id) ?? null),
    flush: () => Promise.resolve(),
  };

  return { fork: () => forked } as unknown as EntityManager;
}

const config = new ConfigService({});

describe('WaveformService.processEpisode', () => {
  it('uses the local file and never downloads when one is already on disk', async () => {
    const analyzed: string[] = [];
    let downloadCalls = 0;
    const service = new WaveformService(
      stubEntityManager({ episodes: new Map([[1, { id: 1 } as Episode]]) }),
      config,
      stubAnalyzer((filePath) => {
        analyzed.push(filePath);
        return Promise.resolve({ peaks: Buffer.from([1, 2, 3]), seconds: 42 });
      }),
      stubDownloader({
        exists: () => Promise.resolve(true),
        download: () => {
          downloadCalls++;
          return Promise.resolve(0);
        },
      }),
    );

    const result = await service.processEpisode({ id: 1, file: 'https://example.test/1.mp3' });

    expect(result).toEqual({ id: 1, status: 'measured', seconds: 42 });
    expect(downloadCalls).toBe(0);
    expect(analyzed).toEqual([join(EPISODES_DIR, '1.mp3')]);
  });

  it('downloads to a temp file when nothing is on disk, and always removes it afterwards', async () => {
    let capturedTempPath = '';
    const service = new WaveformService(
      stubEntityManager({ episodes: new Map([[2, { id: 2 } as Episode]]) }),
      config,
      stubAnalyzer(() => Promise.resolve({ peaks: Buffer.from([9]), seconds: 7 })),
      stubDownloader({
        exists: () => Promise.resolve(false),
        download: async (_url, destination) => {
          capturedTempPath = destination;
          await writeFile(destination, 'fake mp3 bytes');
          return 14;
        },
      }),
    );

    const result = await service.processEpisode({ id: 2, file: 'https://example.test/2.mp3' });

    expect(result).toEqual({ id: 2, status: 'measured', seconds: 7 });
    expect(capturedTempPath.startsWith(tmpdir())).toBe(true);
    expect(await fileExists(capturedTempPath)).toBe(false);
  });

  it('still removes the temp download when analysis fails, and reports failure rather than rejecting', async () => {
    let capturedTempPath = '';
    const service = new WaveformService(
      stubEntityManager(),
      config,
      stubAnalyzer(() => Promise.reject(new Error('ffmpeg exploded'))),
      stubDownloader({
        exists: () => Promise.resolve(false),
        download: async (_url, destination) => {
          capturedTempPath = destination;
          await writeFile(destination, 'fake mp3 bytes');
          return 14;
        },
      }),
    );

    const result = await service.processEpisode({ id: 3, file: 'https://example.test/3.mp3' });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('ffmpeg exploded');
    expect(await fileExists(capturedTempPath)).toBe(false);
  });

  it('reports failure rather than rejecting when the download itself fails', async () => {
    const service = new WaveformService(
      stubEntityManager(),
      config,
      stubAnalyzer(() => Promise.resolve({ peaks: Buffer.from([1]), seconds: 1 })),
      stubDownloader({
        exists: () => Promise.resolve(false),
        download: () => Promise.reject(new Error('HTTP 404')),
      }),
    );

    const result = await service.processEpisode({ id: 4, file: 'https://example.test/4.mp3' });

    expect(result).toEqual({ id: 4, status: 'failed', error: 'HTTP 404' });
  });

  it('backfills duration only when the episode had none', async () => {
    const withDuration = { id: 5, duration: 3600 } as Episode;
    const withoutDuration = { id: 6, duration: undefined } as Episode;
    const service = new WaveformService(
      stubEntityManager({
        episodes: new Map([
          [5, withDuration],
          [6, withoutDuration],
        ]),
      }),
      config,
      stubAnalyzer(() => Promise.resolve({ peaks: Buffer.from([1]), seconds: 999 })),
      stubDownloader({ exists: () => Promise.resolve(true) }),
    );

    await service.processEpisode({ id: 5, file: 'https://example.test/5.mp3' });
    await service.processEpisode({ id: 6, file: 'https://example.test/6.mp3' });

    expect(withDuration.duration).toBe(3600);
    expect(withoutDuration.duration).toBe(999);
    expect(withDuration.waveform).toEqual(Buffer.from([1]));
    expect(withoutDuration.waveform).toEqual(Buffer.from([1]));
  });

  describe('--delete-audio', () => {
    // A fake id far above any real episode (they top out well under 1000), so
    // this never collides with a genuine file a developer has downloaded.
    const FAKE_ID = 999_999_001;
    const localPath = join(EPISODES_DIR, `${FAKE_ID}.mp3`);

    beforeEach(async () => {
      await mkdir(EPISODES_DIR, { recursive: true });
      await writeFile(localPath, 'fake mp3 bytes');
    });

    afterEach(async () => {
      await rm(localPath, { force: true });
    });

    it('deletes a pre-existing local file after success only when asked to', async () => {
      const service = new WaveformService(
        stubEntityManager({ episodes: new Map([[FAKE_ID, { id: FAKE_ID } as Episode]]) }),
        config,
        stubAnalyzer(() => Promise.resolve({ peaks: Buffer.from([1]), seconds: 1 })),
        stubDownloader({ exists: () => fileExists(localPath) }),
      );

      await service.processEpisode(
        { id: FAKE_ID, file: 'https://example.test/x.mp3' },
        { deleteAudioAfter: true },
      );

      expect(await fileExists(localPath)).toBe(false);
    });

    it('leaves the local file alone by default', async () => {
      const service = new WaveformService(
        stubEntityManager({ episodes: new Map([[FAKE_ID, { id: FAKE_ID } as Episode]]) }),
        config,
        stubAnalyzer(() => Promise.resolve({ peaks: Buffer.from([1]), seconds: 1 })),
        stubDownloader({ exists: () => fileExists(localPath) }),
      );

      await service.processEpisode({ id: FAKE_ID, file: 'https://example.test/x.mp3' });

      expect(await fileExists(localPath)).toBe(true);
    });
  });
});

describe('WaveformService.processPending', () => {
  it('measures every candidate and tallies measured/failed separately', async () => {
    const episodes = new Map<number, Episode>([
      [1, { id: 1 } as Episode],
      [2, { id: 2 } as Episode],
    ]);
    const service = new WaveformService(
      stubEntityManager({
        pendingRows: [
          { id: 1, file: 'https://example.test/1.mp3' },
          { id: 2, file: 'https://example.test/2.mp3' },
        ],
        episodes,
      }),
      config,
      stubAnalyzer((filePath) =>
        filePath.includes('2')
          ? Promise.reject(new Error('boom'))
          : Promise.resolve({ peaks: Buffer.from([1]), seconds: 1 }),
      ),
      stubDownloader({ exists: () => Promise.resolve(true) }),
    );

    const summary = await service.processPending({ max: 10 });

    expect(summary.candidates).toBe(2);
    expect(summary.measured).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.errors).toEqual([{ id: 2, error: 'boom' }]);
  });

  it('never rejects, even when the pending-episodes query itself fails', async () => {
    const em = {
      fork: () => ({
        getConnection: () => ({
          execute: () => Promise.reject(new Error('connection refused')),
        }),
      }),
    } as unknown as EntityManager;
    const service = new WaveformService(
      em,
      config,
      stubAnalyzer(() => Promise.resolve({ peaks: Buffer.from([1]), seconds: 1 })),
      stubDownloader(),
    );

    const summary = await service.processPending({ max: 10 });

    expect(summary).toEqual({
      candidates: 0,
      measured: 0,
      failed: 0,
      errors: [],
      error: 'connection refused',
    });
  });

  it('skips a run that starts while a previous one is still in flight', async () => {
    let releaseFirst: () => void = () => undefined;
    const gate = new Promise<void>((resolvePromise) => {
      releaseFirst = resolvePromise;
    });
    let queries = 0;
    const service = new WaveformService(
      stubEntityManager({
        pendingRows: [{ id: 1, file: 'https://example.test/1.mp3' }],
        onQuery: () => {
          queries++;
        },
      }),
      config,
      stubAnalyzer(async () => {
        await gate;
        return { peaks: Buffer.from([1]), seconds: 1 };
      }),
      stubDownloader({ exists: () => Promise.resolve(true) }),
    );

    const first = service.processPending({ max: 10 });
    const second = await service.processPending({ max: 10 });

    expect(second).toEqual({ candidates: 0, measured: 0, failed: 0, errors: [] });
    expect(queries).toBe(1);

    releaseFirst();
    await first;
  });
});
