import { BadGatewayException, GatewayTimeoutException, Injectable } from '@nestjs/common';
import { EPISODE_DOWNLOAD_USER_AGENT } from '../../waveform/episode-download';

// `GET /episodes/:id/audio`'s upstream half: a same-origin passthrough to
// `episode.file`. ⚠️ Kept behind DI for the same reason `EpisodeDownloader` and
// `FeedClient` are — the integration suite can hand this a fake and never
// reach gravina82.com.

// Short on purpose. `EPISODE_DOWNLOAD_TIMEOUT_MS` (10 minutes, `episode-
// download.ts`) covers pulling a WHOLE mp3 to disk for the waveform job; this
// is a browser waiting on a few-hundred-KB slice for a clip it is about to cut.
// `AbortSignal.timeout` covers the body transfer too, not just the headers, so
// this has to be generous enough for a slow link to finish one range, not just
// connect.
export const EPISODE_AUDIO_TIMEOUT_MS = 30_000;

/** The upstream response, unconsumed: the controller streams `body` straight
 *  through without this proxy ever buffering it. */
export interface UpstreamAudio {
  /** 206 for an honoured `Range`, 200 for the whole file. */
  readonly status: number;
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | null;
  /** Cancels the upstream request. The controller wires this to the client's
   *  `res.on('close', …)`, so walking away mid-download does not leave a
   *  socket open to gravina82.com for nobody. */
  readonly abort: () => void;
}

@Injectable()
export class EpisodeAudioProxy {
  async open(url: string, range: string | undefined): Promise<UpstreamAudio> {
    const controller = new AbortController();
    // Either signal ends the fetch: the caller aborting for a disconnected
    // client, or the timeout below. Node/undici support `AbortSignal.any`.
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(EPISODE_AUDIO_TIMEOUT_MS),
    ]);

    let response: Response;
    try {
      response = await fetch(url, {
        // Resolves the blubrry-style `media.blubrry.com/…` 302s transparently
        // — the frontend never sees a gravina82.com URL at all.
        redirect: 'follow',
        signal,
        headers: {
          'user-agent': EPISODE_DOWNLOAD_USER_AGENT,
          ...(range !== undefined ? { range } : {}),
        },
      });
    } catch (error) {
      // `open()` itself never calls `controller.abort()` — that closure is
      // only handed to the caller once this returns — so an abort seen HERE
      // can only be the timeout firing.
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new GatewayTimeoutException("The episode's mp3 host did not answer in time.");
      }
      throw new BadGatewayException("Could not reach the episode's mp3 host.");
    }

    if (!response.ok) {
      // Deliberately no upstream URL in the message: it is this project's
      // implementation detail, not the caller's business.
      throw new BadGatewayException("The episode's mp3 host answered with an error.");
    }

    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
      abort: () => controller.abort(),
    };
  }
}
