import request from 'supertest';
import { WAVEFORM_POINTS_PER_SECOND } from '../../waveform/waveform.constants';
import { createTestContext, seed, SeededIds, TestContext } from './episodes.testing';

// ⚠️ **Needs a real postgres** (the compose one, host port 5433) — reuses the
// same harness and seed as `episodes.integration.spec.ts` (`GET
// /episodes/:id/waveform` lives in the same module), but in its OWN database:
// Jest runs spec files in parallel workers, and two of them recreating a
// database of the SAME name at the same time is exactly the race that made
// `episodes.integration.spec.ts` itself fail intermittently before this file
// existed. This suite only ADDS a `waveform` blob to one already-seeded
// episode; it never touches the shared `seed()` helper.
const WAVEFORM_TEST_DB_NAME = 'gravindex_test_episode_waveform';

jest.setTimeout(60_000);

let app: TestContext['app'];
let orm: TestContext['orm'];
let ids: SeededIds;
let http: ReturnType<TestContext['app']['getHttpServer']>;

interface WaveformBody {
  from: number;
  to: number;
  points: number;
  peaks: string;
}

// 100 increasing bytes — 10 seconds' worth at WAVEFORM_POINTS_PER_SECOND — so
// every assertion below can tell which slice it got back just by looking at
// the decoded values.
const WAVEFORM_BYTES = Buffer.from(Array.from({ length: 100 }, (_, i) => i));

const waveform = (id: number, query = ''): request.Test =>
  request(http).get(`/api/episodes/${id}/waveform${query}`);

function decode(body: WaveformBody): number[] {
  return Array.from(Buffer.from(body.peaks, 'base64'));
}

beforeAll(async () => {
  const context = await createTestContext(WAVEFORM_TEST_DB_NAME);

  app = context.app;
  orm = context.orm;
  http = app.getHttpServer();
  ids = await seed(orm.em.fork());

  // Written directly through a raw update rather than the ffmpeg pipeline —
  // this suite is about the READ side, and `waveform-analyzer.spec.ts` already
  // covers measuring real audio end to end.
  await orm.em
    .fork()
    .getConnection()
    .execute('update "episode" set "waveform" = ? where "id" = ?', [
      WAVEFORM_BYTES,
      ids.episodes.cancion,
    ]);
});

afterAll(async () => {
  await app?.close();
  await orm?.close(true);
});

describe('GET /episodes/:id/waveform', () => {
  it('404s for an episode that does not exist', async () => {
    await waveform(999_999).expect(404);
  });

  it('answers 200 with an empty waveform for an episode that has none yet, not a 404', async () => {
    const { body } = await waveform(ids.episodes.sinClips).expect(200);

    expect(body).toEqual({ from: 0, to: 0, points: 0, peaks: '' });
  });

  it('echoes back the requested `to` on an unmeasured episode rather than inventing one', async () => {
    const { body } = await waveform(ids.episodes.sinClips, '?from=5&to=20').expect(200);

    expect(body).toEqual({ from: 5, to: 20, points: 0, peaks: '' });
  });

  it('returns the whole stored waveform, unresampled, when it is shorter than the default points', async () => {
    const { body } = await waveform(ids.episodes.cancion).expect(200);

    expect(body.from).toBe(0);
    expect(body.to).toBe(WAVEFORM_BYTES.length / WAVEFORM_POINTS_PER_SECOND);
    expect(body.points).toBe(WAVEFORM_BYTES.length);
    expect(decode(body)).toEqual(Array.from(WAVEFORM_BYTES));
  });

  it('slices by seconds and resamples down by taking the max of each window', async () => {
    const { body } = await waveform(ids.episodes.cancion, '?from=2&to=5&points=10').expect(200);

    expect(body).toEqual({
      from: 2,
      to: 5,
      points: 10,
      peaks: expect.any(String),
    });
    // Bytes 20..49 (seconds 2..5 at 10 bytes/second), downsampled 30 -> 10 by
    // MAXIMUM per window — since the source is strictly increasing, that is
    // the last byte of every 3-byte window: 22, 25, 28, ... 49.
    expect(decode(body)).toEqual([22, 25, 28, 31, 34, 37, 40, 43, 46, 49]);
  });

  it('clamps a request entirely past the end of the measured audio to an empty slice', async () => {
    const { body } = await waveform(ids.episodes.cancion, '?from=15&to=20').expect(200);

    expect(body).toEqual({ from: 10, to: 10, points: 0, peaks: '' });
  });

  it('never returns more bytes than the slice actually has, however many points are asked for', async () => {
    const { body } = await waveform(ids.episodes.cancion, '?points=2000').expect(200);

    expect(body.points).toBe(WAVEFORM_BYTES.length);
  });

  it.each(['?from=-1', '?to=-1', '?points=0', '?points=2001', '?from=abc', '?points=1.5'])(
    'answers 400 for %s',
    async (query) => {
      await waveform(ids.episodes.cancion, query).expect(400);
    },
  );
});
