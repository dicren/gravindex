import type {
  EpisodeAudioRange,
  EpisodeAudioRepository,
} from '#/domain/episodes/episode-audio.repository';
import { NetworkError } from '#/domain/errors';
import { episodesControllerGetAudio } from '#/infrastructure/generated';
import { createClient, createConfig } from '#/infrastructure/generated/client';
import { resolveApiBaseUrl } from '#/infrastructure/http/api-client.config';
import { audioHttpTransport } from '#/infrastructure/http/http-transport';
import { assertResponseOk, translateHttpError } from '#/infrastructure/http/translate-http-error';

/**
 * ⚠️ **Its own `Client`, not the shared generated one.** Every other adapter in
 * this folder calls a generated operation with the default client, which goes
 * through `httpTransport` — a `ky` instance sized for JSON, ten seconds. A
 * `Range` read here is up to ~1 MB, not a few hundred bytes, so it goes through
 * `audioHttpTransport` instead (`http-transport.ts`). `resolveApiBaseUrl()` is
 * shared with `api-client.config.ts` so the two clients can never resolve to a
 * different origin.
 */
const audioClient = createClient(
  createConfig({ baseUrl: resolveApiBaseUrl(), fetch: audioHttpTransport }),
);

/**
 * Reads byte ranges of an episode's mp3 through the backend's same-origin
 * passthrough (`GET /episodes/:id/audio`) — never gravina82.com directly, which
 * sends no `Access-Control-*` headers and so cannot be `fetch()`ed from here at
 * all. See `EpisodeAudioRepository` for the full rationale.
 *
 * ⚠️ `parseAs: 'arrayBuffer'` is the one thing every other repository in this
 * package does not need. Every other endpoint answers JSON, and the generated
 * client defaults to parsing exactly that; this one answers `audio/mpeg`, and
 * without an explicit `parseAs` the client would try `JSON.parse()` on raw MP3
 * bytes and fail every call. The generated response type (`Blob | File`) is
 * therefore a lie about this ONE call's actual runtime shape — the generator
 * has no way to know a caller overrides `parseAs` — hence the cast below.
 */
export class EpisodeAudioHttpRepository implements EpisodeAudioRepository {
  async readRange(episodeId: number, from: number, to: number): Promise<EpisodeAudioRange> {
    try {
      const {
        data,
        error: failure,
        response,
      } = await episodesControllerGetAudio({
        client: audioClient,
        path: { id: episodeId },
        headers: { Range: `bytes=${from}-${to}` },
        parseAs: 'arrayBuffer',
      });
      assertResponseOk(response, failure);
      if (response === undefined) {
        // Unreachable — `assertResponseOk` already throws for this case — but
        // the type still allows it.
        throw new NetworkError('The request never reached the server.');
      }

      const contentRange = response.headers.get('content-range');
      const totalBytes = contentRange === null ? NaN : Number(contentRange.split('/')[1]);
      if (!Number.isFinite(totalBytes)) {
        throw new NetworkError("The server's answer carried no usable Content-Range.");
      }

      return { bytes: new Uint8Array(data as unknown as ArrayBuffer), totalBytes };
    } catch (error) {
      throw translateHttpError(error);
    }
  }
}
