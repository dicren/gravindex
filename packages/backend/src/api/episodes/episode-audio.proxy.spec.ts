import { BadGatewayException, GatewayTimeoutException } from '@nestjs/common';
import { EpisodeAudioProxy } from './episode-audio.proxy';

// ⚠️ No real network. `fetch` is global in Node 24, so it is stubbed directly —
// there is no `FeedClient`/`EpisodeDownloader`-style seam to fake instead,
// because this proxy IS that seam for `GET /episodes/:id/audio`.

interface StubOptions {
  ok?: boolean;
  status?: number;
  body?: ReadableStream<Uint8Array>;
  headers?: Record<string, string>;
}

function stubResponse(options: StubOptions = {}): Response {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 206,
    body: options.body ?? new ReadableStream(),
    headers: new Headers(options.headers),
  } as Response;
}

describe('EpisodeAudioProxy', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('forwards the Range header verbatim, and follows redirects', async () => {
    const fetchSpy = jest.fn().mockResolvedValue(stubResponse());
    global.fetch = fetchSpy;

    await new EpisodeAudioProxy().open('https://example.invalid/e.mp3', 'bytes=0-1023');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.invalid/e.mp3',
      expect.objectContaining({
        redirect: 'follow',
        headers: expect.objectContaining({ range: 'bytes=0-1023' }),
      }),
    );
  });

  it('sends no Range header at all when none was given, rather than an empty one', async () => {
    const fetchSpy = jest.fn().mockResolvedValue(stubResponse());
    global.fetch = fetchSpy;

    await new EpisodeAudioProxy().open('https://example.invalid/e.mp3', undefined);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty('range');
  });

  it('hands back the status, headers and body of a successful upstream response', async () => {
    const body = new ReadableStream();
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        stubResponse({ status: 206, body, headers: { 'content-range': 'bytes 0-9/100' } }),
      );

    const result = await new EpisodeAudioProxy().open('https://example.invalid/e.mp3', 'bytes=0-9');

    expect(result.status).toBe(206);
    expect(result.body).toBe(body);
    expect(result.headers.get('content-range')).toBe('bytes 0-9/100');
  });

  it('rejects with a 502 rather than the raw error when the upstream answers with a failure status', async () => {
    global.fetch = jest.fn().mockResolvedValue(stubResponse({ ok: false, status: 404 }));

    await expect(
      new EpisodeAudioProxy().open('https://example.invalid/gone.mp3', undefined),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('rejects with a 502 when the upstream host cannot be reached at all', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

    await expect(
      new EpisodeAudioProxy().open('https://example.invalid/e.mp3', undefined),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('rejects with a 504, not a 502, when the fetch times out', async () => {
    const timeoutError = new Error('The operation was aborted due to timeout');
    timeoutError.name = 'TimeoutError';
    global.fetch = jest.fn().mockRejectedValue(timeoutError);

    await expect(
      new EpisodeAudioProxy().open('https://example.invalid/slow.mp3', undefined),
    ).rejects.toBeInstanceOf(GatewayTimeoutException);
  });

  it('returns an `abort` that cancels the upstream request', async () => {
    global.fetch = jest.fn().mockResolvedValue(stubResponse());

    const result = await new EpisodeAudioProxy().open('https://example.invalid/e.mp3', undefined);

    // Nothing throws, and calling it twice is still safe — `AbortController`
    // tolerates a repeat `abort()`, which is what a slow `close` plus a client
    // retry could produce.
    expect(() => {
      result.abort();
      result.abort();
    }).not.toThrow();
  });
});
