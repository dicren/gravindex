// The shared fixtures every behaviour spec builds on.
//
// Three things happen to every page this suite opens, and each of them is a
// decision rather than convenience:
//
//   1. **The media host is intercepted** (`lib/media.ts`). No test may reach a
//      third party's server.
//   2. **The anonymous voter token is planted**, so the rows a test writes are
//      findable afterwards by exactly the value it chose. The app would
//      otherwise generate its own UUID and the cleanup would be guessing.
//   3. **`POST /clips/:id/play` is answered locally.** It is fire-and-forget and
//      nothing reads the `playback` table back, so letting the real one through
//      would append rows to the pristine fixture for no assertion's benefit. The
//      calls are still COUNTED here, which is the part worth asserting.
//
// Plus one observation seam: `window.Audio` is wrapped so a test can read the
// element the application actually built. That is instrumentation of the test's
// own page, not a change to the application — the constructor still returns a
// real `HTMLAudioElement`, and the app cannot tell.
//
// ⚠️ **The seam grew a second half on 2026-10-27, and it is the same idea**: the
// playback store now believes the ELEMENT (`play`/`pause`/`ended`/`error`)
// rather than its own calls, so the only way to reproduce a system pause, an
// `ended` the browser never really reached, or a source that fails twice is to
// make the element say so. Nothing here fakes the store: the app's own listeners
// run, on the element the app built, exactly as they run for a browser event.

import { test as base, expect, type Page } from '@playwright/test';
import { interceptClipAudioDownload } from './audio-download';
import { interceptEpisodeMedia } from './media';
import { voterToken } from './constants';

/**
 * The events a spec may make the element fire by hand.
 *
 * ⚠️ Deliberately the same union the playback store listens for, minus the ones
 * no test needs to invent (`suspend`, `durationchange`, `canplay`): a synthetic
 * `canplay` would promise metadata that is not there, and one that lies about
 * the stream is worse than no seam at all.
 */
export type SyntheticAudioEvent =
  | 'ended'
  | 'error'
  | 'pause'
  | 'play'
  | 'playing'
  | 'waiting'
  | 'stalled'
  | 'loadstart'
  | 'timeupdate';

/** The observation seam the page keeps, see `page`'s `addInitScript`. */
export interface AudioSeam {
  /** The element built last — the app's own, since it builds exactly one. */
  latest: () => HTMLAudioElement | null;
  /** Dispatch `type` on that element. `false` when none exists yet. */
  emit: (type: SyntheticAudioEvent) => boolean;
  /** The element's `src` as the DOM normalised it (`''` once released). */
  src: () => string | null;
}

declare global {
  interface Window {
    /** Every `new Audio()` the page has built, in order. */
    __e2eAudio?: HTMLAudioElement[];
    /** The functions above, kept on the page so a spec can call them. */
    __e2eAudioSeam?: AudioSeam;
  }
}

/** One request the page made to the API, already taken apart. */
export interface ApiCall {
  readonly method: string;
  readonly url: string;
  readonly pathname: string;
  readonly search: URLSearchParams;
}

export class ApiRecorder {
  private readonly calls: ApiCall[] = [];

  record(call: ApiCall): void {
    this.calls.push(call);
  }

  /** Every recorded call, optionally narrowed to a path prefix. */
  all(pathPrefix?: string): readonly ApiCall[] {
    if (pathPrefix === undefined) return [...this.calls];
    return this.calls.filter((call) => call.pathname.startsWith(pathPrefix));
  }

  /** Requests for the library list. The debounce group counts exactly these. */
  clipLists(): readonly ApiCall[] {
    return this.calls.filter((call) => call.method === 'GET' && call.pathname === '/api/clips');
  }

  episodeLists(): readonly ApiCall[] {
    return this.calls.filter((call) => call.method === 'GET' && call.pathname === '/api/episodes');
  }

  clear(): void {
    this.calls.length = 0;
  }
}

/** Play registrations, intercepted rather than written. */
export class PlayRecorder {
  readonly clipIds: number[] = [];
}

interface AppFixtures {
  /**
   * The anonymous voter token this test's writes carry, readable by a spec that
   * wants to find its own rows.
   *
   * ⚠️ It is derived from `page` rather than standing on its own, which is not
   * indirection for its own sake: a fixture with no dependencies has to be
   * written `async ({}, use)`, and an empty destructuring pattern is a lint
   * error this suite is not allowed to silence. Reading it back off the page
   * that planted it is the honest version anyway — one token, one browser.
   */
  voterToken: string;
  api: ApiRecorder;
  plays: PlayRecorder;
  /**
   * Navigate and settle. ⚠️ It also asserts the consent banner is ABSENT —
   * explicitly, every time. With no `VITE_GA4_ID` configured the banner does not
   * render at all (there is no cookie to consent to), which is the normal state
   * here; if that ever changes, an overlay would start swallowing clicks and
   * every interaction group would fail for a reason that has nothing to do with
   * what it tests. This turns that into one honest failure with the right name.
   */
  gotoApp: (path: string) => Promise<void>;
}

/** The token each page was given, so `voterToken` can hand it back without a
 *  round trip into a browser that may not have navigated anywhere yet. */
const plantedTokens = new WeakMap<Page, string>();

function randomHex(length: number): string {
  let out = '';
  while (out.length < length) out += Math.floor(Math.random() * 16).toString(16);
  return out.slice(0, length);
}

export const test = base.extend<AppFixtures>({
  voterToken: async ({ page }, use) => {
    const planted = plantedTokens.get(page);
    if (planted === undefined) throw new Error('the page fixture did not plant a voter token');
    await use(planted);
  },

  api: async ({ page }, use) => {
    const recorder = new ApiRecorder();
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return;
      recorder.record({
        method: request.method(),
        url: request.url(),
        pathname: url.pathname,
        search: url.searchParams,
      });
    });
    await use(recorder);
  },

  // ⚠️ `auto`, and it has to be. On demand, a spec that plays a clip without
  // ASKING for this fixture never installs the route, and the real
  // `POST /clips/:id/play` writes a row into the pristine `playback` table. That
  // is not hypothetical: it is how this suite first failed its own teardown.
  plays: [
    async ({ page }, use) => {
      const recorder = new PlayRecorder();
      await page.route('**/api/clips/*/play', async (route) => {
        const match = /\/api\/clips\/(\d+)\/play/.exec(new URL(route.request().url()).pathname);
        if (match !== null) recorder.clipIds.push(Number(match[1]));
        await route.fulfill({
          status: 201,
          headers: { 'content-type': 'application/json' },
          body: '{"id":0}',
        });
      });
      await use(recorder);
    },
    { auto: true },
  ],

  page: async ({ page }, use) => {
    const token = voterToken(randomHex(12));
    plantedTokens.set(page, token);
    await interceptEpisodeMedia(page);
    // ⚠️ `auto` for the same reason `plays` is: a spec that clicks download
    // without asking for this fixture would otherwise send the e2e backend a
    // real outbound request to whatever `episode.file` says.
    await interceptClipAudioDownload(page);

    await page.addInitScript((planted: string) => {
      window.localStorage.setItem('gravindex.voter-token', planted);

      const Original = window.Audio;
      const log: HTMLAudioElement[] = [];
      window.__e2eAudio = log;
      const Wrapped = function (this: unknown, src?: string): HTMLAudioElement {
        const element = new Original(src);
        log.push(element);
        return element;
      } as unknown as typeof Audio;
      Wrapped.prototype = Original.prototype;
      window.Audio = Wrapped;

      // ⚠️ `latest()` and not "the element with the src": the editor owns an
      // element of its own, and every spec that uses this seam is about the
      // global player.
      const latest = (): HTMLAudioElement | null => log[log.length - 1] ?? null;

      window.__e2eAudioSeam = {
        latest,
        emit: (type) => {
          const element = latest();
          if (element === null) return false;
          element.dispatchEvent(new Event(type));
          return true;
        },
        src: () => latest()?.src ?? null,
      };
    }, token);

    await use(page);
  },

  gotoApp: async ({ page }, use) => {
    await use(async (path: string) => {
      await page.goto(path);
      await expect(page.locator('[data-testid="consent-banner"]')).toHaveCount(0);
    });
  },
});

export { expect } from '@playwright/test';

/** The audio element the application built, as the browser currently sees it. */
export async function audioState(
  page: Page,
): Promise<{ count: number; currentTime: number; paused: boolean; src: string }[]> {
  return page.evaluate(() => {
    const log = window.__e2eAudio ?? [];
    return log.map((element) => ({
      count: log.length,
      currentTime: element.currentTime,
      paused: element.paused,
      src: element.src,
    }));
  });
}

/**
 * Make the element fire `type`, exactly as a browser event would.
 *
 * ⚠️ **`ended` and `error` are not reachable any other way in a browser test.**
 * A clip never really runs out — the store stops it at `clip.end` on
 * `timeupdate` — and the fixture answers every mp3 successfully, so an `ended`
 * that arrives while a cut is still playing, and a source that will not load,
 * are both states only a dispatched event can produce. The app's own listeners
 * are the ones that run.
 *
 * Returns `false` when the app has not built its element yet, so a spec fails on
 * its own assertion rather than on a timeout here.
 */
export async function emitAudioEvent(page: Page, type: SyntheticAudioEvent): Promise<boolean> {
  return page.evaluate((event) => window.__e2eAudioSeam?.emit(event) ?? false, type);
}

/**
 * **Pause the element the way the platform does, not the way the app does.**
 *
 * ⚠️ The app is not consulted and no store method is called: `HTMLMediaElement.pause()`
 * makes the browser fire its own `pause` event, which is precisely the case the
 * playback store has to survive (a call arriving, headphones unplugged, the OS
 * pausing media). Dispatching a synthetic `pause` instead would leave the
 * element *actually playing*, and the recovery this seam exists to test could
 * then never be observed — the element would already be running when
 * `reconcile()` looked at it.
 */
export async function pauseAudioElement(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const element = window.__e2eAudioSeam?.latest() ?? null;
    if (element === null) return false;
    element.pause();
    return true;
  });
}

/** The source the element is holding, normalised by the DOM. `null` before the
 *  app has built one. */
export async function audioSource(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__e2eAudioSeam?.src() ?? null);
}

/** `hh:mm:ss` → seconds. ⚠️ Written here rather than imported from the app: a
 *  test that reused the app's own converter would be comparing the app with
 *  itself, which proves nothing about what the screen said. */
export function hhmmssToSeconds(label: string): number {
  const match = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(label.trim());
  if (match === null) throw new Error(`not a timecode: ${JSON.stringify(label)}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/** The inverse, for the same reason. */
export function secondsToHhmmss(seconds: number): string {
  const total = Math.floor(seconds);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total / 60) % 60))}:${pad(total % 60)}`;
}
