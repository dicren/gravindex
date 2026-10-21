import request from 'supertest';
import { BadGatewayException, GatewayTimeoutException } from '@nestjs/common';
import { EpisodeAudioProxy, UpstreamAudio } from './episode-audio.proxy';
import { createTestContext, seed, SeededIds, TestContext } from './episodes.testing';

// ⚠️ **Needs a real postgres** (the compose one, host port 5433) — reuses the
// same harness and seed as `episodes.integration.spec.ts`, in its OWN database
// (see that file's comment on why: two Jest workers recreating a database of
// the same name at the same time is a real race this repo already hit once).
//
// ⚠️ **Never reaches gravina82.com.** `EpisodeAudioProxy` is swapped for a fake
// at the DI level (`createTestContext`'s second argument), so this suite
// proves the CONTROLLER/SERVICE wiring — routing, status codes, header
// passthrough — not the real upstream fetch, which `episode-audio.proxy.spec.ts`
// already covers against a stubbed `fetch`.
const AUDIO_TEST_DB_NAME = 'gravindex_test_episode_audio';

jest.setTimeout(60_000);

let app: TestContext['app'];
let orm: TestContext['orm'];
let ids: SeededIds;
let http: ReturnType<TestContext['app']['getHttpServer']>;

let lastOpenCall: { url: string; range: string | undefined } | undefined;
let nextResponse: (() => Promise<UpstreamAudio>) | undefined;

const fakeProxy: EpisodeAudioProxy = {
  open: async (url: string, range: string | undefined) => {
    lastOpenCall = { url, range };
    if (nextResponse === undefined) {
      throw new Error('test forgot to set `nextResponse` before calling the endpoint');
    }
    return nextResponse();
  },
} as EpisodeAudioProxy;

function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

const audio = (id: number, range?: string): request.Test => {
  const req = request(http).get(`/api/episodes/${id}/audio`);
  return range === undefined ? req : req.set('Range', range);
};

beforeAll(async () => {
  const context = await createTestContext(AUDIO_TEST_DB_NAME, fakeProxy);

  app = context.app;
  orm = context.orm;
  http = app.getHttpServer();
  ids = await seed(orm.em.fork());
});

afterAll(async () => {
  await app?.close();
  await orm?.close(true);
});

beforeEach(() => {
  lastOpenCall = undefined;
  nextResponse = undefined;
});

describe('GET /episodes/:id/audio', () => {
  it('404s for an episode that does not exist, without ever calling the upstream proxy', async () => {
    await audio(999_999, 'bytes=0-9').expect(404);

    expect(lastOpenCall).toBeUndefined();
  });

  it('forwards the incoming Range verbatim, against the URL stored on the episode', async () => {
    nextResponse = async () => ({
      status: 206,
      headers: new Headers({ 'content-range': 'bytes 0-9/100', 'content-length': '10' }),
      body: streamOf('0123456789'),
      abort: () => undefined,
    });

    await audio(ids.episodes.cancion, 'bytes=0-9').expect(206);

    expect(lastOpenCall).toEqual({
      url: 'https://example.invalid/audio.mp3',
      range: 'bytes=0-9',
    });
  });

  it('streams a 206 back with Content-Range preserved and the content type forced to audio/mpeg', async () => {
    nextResponse = async () => ({
      status: 206,
      headers: new Headers({ 'content-range': 'bytes 0-9/100', 'content-length': '10' }),
      body: streamOf('0123456789'),
      abort: () => undefined,
    });

    const res = await audio(ids.episodes.cancion, 'bytes=0-9').expect(206);

    expect(res.headers['content-range']).toBe('bytes 0-9/100');
    expect(res.headers['content-length']).toBe('10');
    expect(res.headers['content-type']).toBe('audio/mpeg');
    expect(res.headers['accept-ranges']).toBe('bytes');
  });

  it('serves the whole file, with no Range header sent at all, when the client sent none', async () => {
    nextResponse = async () => ({
      status: 200,
      headers: new Headers({ 'content-length': '10' }),
      body: streamOf('0123456789'),
      abort: () => undefined,
    });

    await audio(ids.episodes.cancion).expect(200);

    expect(lastOpenCall).toEqual({ url: 'https://example.invalid/audio.mp3', range: undefined });
  });

  it('answers 502 when the upstream mp3 host errors', async () => {
    nextResponse = async () => {
      throw new BadGatewayException();
    };

    await audio(ids.episodes.cancion, 'bytes=0-9').expect(502);
  });

  it('answers 504 when the upstream mp3 host does not answer in time', async () => {
    nextResponse = async () => {
      throw new GatewayTimeoutException();
    };

    await audio(ids.episodes.cancion, 'bytes=0-9').expect(504);
  });
});
