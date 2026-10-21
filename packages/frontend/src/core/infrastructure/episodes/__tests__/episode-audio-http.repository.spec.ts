import { afterEach, describe, expect, it, vi } from 'vitest';
import { NetworkError, NotFoundError, RequestRejectedError } from '#/domain/errors';
import { EpisodeAudioHttpRepository } from '../episode-audio-http.repository';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function stubFetch(response: Response) {
  const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(response);
  globalThis.fetch = fetchStub;
  return fetchStub;
}

function audioResponse(bytes: Uint8Array, contentRange: string, status = 206): Response {
  // `new Uint8Array(bytes)` copies into an ordinary `ArrayBuffer`-backed view —
  // see `save-file.ts` for why the plain `Uint8Array` type is not enough here.
  return new Response(new Uint8Array(bytes), {
    status,
    headers: { 'content-type': 'audio/mpeg', 'content-range': contentRange },
  });
}

function urlOf(fetchStub: ReturnType<typeof stubFetch>): URL {
  const request = fetchStub.mock.calls[0]?.[0];
  expect(request).toBeInstanceOf(Request);
  return new URL((request as Request).url);
}

function headersOf(fetchStub: ReturnType<typeof stubFetch>): Headers {
  const request = fetchStub.mock.calls[0]?.[0];
  expect(request).toBeInstanceOf(Request);
  return (request as Request).headers;
}

describe('EpisodeAudioHttpRepository.readRange', () => {
  it('requests the exact same-origin path, never a gravina82.com URL', async () => {
    const fetchStub = stubFetch(audioResponse(new Uint8Array([1, 2, 3]), 'bytes 0-2/100'));

    await new EpisodeAudioHttpRepository().readRange(148, 0, 2);

    const url = urlOf(fetchStub);
    expect(url.pathname).toBe('/api/episodes/148/audio');
  });

  it('sends the byte range as a `Range` header', async () => {
    const fetchStub = stubFetch(audioResponse(new Uint8Array([1, 2, 3]), 'bytes 10-12/100'));

    await new EpisodeAudioHttpRepository().readRange(148, 10, 12);

    expect(headersOf(fetchStub).get('range')).toBe('bytes=10-12');
  });

  it('returns the raw bytes and the total size parsed out of Content-Range', async () => {
    const bytes = new Uint8Array([9, 8, 7, 6]);
    stubFetch(audioResponse(bytes, 'bytes 0-3/86123456'));

    const range = await new EpisodeAudioHttpRepository().readRange(148, 0, 3);

    expect(Array.from(range.bytes)).toEqual([9, 8, 7, 6]);
    expect(range.totalBytes).toBe(86_123_456);
  });

  it('rejects with NetworkError when the response carries no Content-Range', async () => {
    stubFetch(
      new Response(new Uint8Array([1]), {
        status: 206,
        headers: { 'content-type': 'audio/mpeg' },
      }),
    );

    await expect(new EpisodeAudioHttpRepository().readRange(148, 0, 0)).rejects.toBeInstanceOf(
      NetworkError,
    );
  });

  it('surfaces a missing episode as NotFoundError', async () => {
    stubFetch(new Response(null, { status: 404 }));

    await expect(new EpisodeAudioHttpRepository().readRange(999_999, 0, 9)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('surfaces a malformed id as RequestRejectedError, the same as every other 4xx', async () => {
    stubFetch(
      new Response(JSON.stringify({ message: 'A non-numeric or non-positive id.' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(new EpisodeAudioHttpRepository().readRange(-1, 0, 9)).rejects.toBeInstanceOf(
      RequestRejectedError,
    );
  });

  it('surfaces an upstream failure (502/504) as NetworkError, not a parsed refusal', async () => {
    stubFetch(new Response(null, { status: 502 }));

    await expect(new EpisodeAudioHttpRepository().readRange(148, 0, 9)).rejects.toBeInstanceOf(
      NetworkError,
    );
  });
});
