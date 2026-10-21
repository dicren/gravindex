import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  analyticsMeasurementId,
  isAnalyticsConfigured,
  isAnalyticsLoaded,
  loadAnalytics,
  trackPageView,
  unloadAnalytics,
} from '@/analytics/ga4';

/**
 * ⚠️ **This is a privacy feature, so the assertions are the deliverable.**
 * "Nothing loads before consent" is not something a reader can verify by looking
 * at the component — it is a claim about what the document contains and what the
 * network sees, and the only honest form of it is an assertion. Every `expect`
 * below is one of those claims.
 *
 * The module under test is stateless by design: "is it loaded?" is answered by
 * the DOM, so these tests reset the DOM and nothing else.
 */

const MEASUREMENT_ID = 'G-TESTID1234';

interface GtagWindow {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
}

const gtagWindow = () => window as Window & GtagWindow;

const scripts = () => [...document.querySelectorAll('script[data-grav-analytics]')];

/** Every `gtag(...)` call, as plain arrays — the queue holds `Arguments`. */
function calls(): unknown[][] {
  return (gtagWindow().dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>));
}

const disableFlag = () =>
  (window as unknown as Record<string, unknown>)[`ga-disable-${MEASUREMENT_ID}`];

function cookieNames(): string[] {
  return document.cookie
    .split(';')
    .map((pair) => pair.split('=')[0]?.trim() ?? '')
    .filter((name) => name !== '');
}

beforeEach(() => {
  vi.stubEnv('VITE_GA4_ID', MEASUREMENT_ID);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const script of scripts()) script.remove();
  delete gtagWindow().dataLayer;
  delete gtagWindow().gtag;
  delete (window as unknown as Record<string, unknown>)[`ga-disable-${MEASUREMENT_ID}`];
  for (const name of cookieNames()) document.cookie = `${name}=; path=/; max-age=0`;
});

describe('before anything is loaded', () => {
  it('has put no tag in the document and no gtag on the window', () => {
    // The state of every page in this app until somebody presses "Aceptar".
    expect(scripts()).toHaveLength(0);
    expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
    expect(gtagWindow().gtag).toBeUndefined();
    expect(gtagWindow().dataLayer).toBeUndefined();
    expect(isAnalyticsLoaded()).toBe(false);
  });

  it('sends nothing when asked to track a page view', () => {
    trackPageView('http://localhost:3000/');

    expect(gtagWindow().dataLayer).toBeUndefined();
    expect(scripts()).toHaveLength(0);
  });
});

describe('with no measurement id configured', () => {
  /**
   * ⚠️ The normal state of this repository and of every development machine: no
   * id is committed, and the app must behave perfectly without one.
   */
  beforeEach(() => {
    vi.stubEnv('VITE_GA4_ID', '');
  });

  it('reports itself unconfigured rather than failing', () => {
    expect(analyticsMeasurementId()).toBe('');
    expect(isAnalyticsConfigured()).toBe(false);
  });

  it('loads nothing, throws nothing, and leaves the document alone', () => {
    expect(() => {
      loadAnalytics();
      trackPageView('http://localhost:3000/');
      unloadAnalytics();
    }).not.toThrow();

    expect(scripts()).toHaveLength(0);
    expect(gtagWindow().gtag).toBeUndefined();
    expect(gtagWindow().dataLayer).toBeUndefined();
    expect(document.cookie).toBe('');
  });

  it('treats whitespace as absent — a blank line in `.env` is not a property', () => {
    vi.stubEnv('VITE_GA4_ID', '   ');
    expect(isAnalyticsConfigured()).toBe(false);
    loadAnalytics();
    expect(scripts()).toHaveLength(0);
  });
});

describe('accepting', () => {
  it('injects exactly one tag, pointing at the configured property', () => {
    loadAnalytics();

    expect(scripts()).toHaveLength(1);
    const script = scripts()[0] as HTMLScriptElement;
    expect(script.src).toBe(`https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`);
    expect(script.async).toBe(true);
    expect(isAnalyticsLoaded()).toBe(true);
  });

  it('configures the property without firing a page view of its own', () => {
    loadAnalytics();

    expect(calls()[0]?.[0]).toBe('js');
    expect(calls()[1]).toEqual(['config', MEASUREMENT_ID, { send_page_view: false }]);

    // ⚠️ The whole reason for `send_page_view: false`: `config` would count the
    // entry screen, and the router hook counts it again.
    expect(calls().filter((call) => call[1] === 'page_view')).toHaveLength(0);
  });

  it('queues commands in the one shape gtag.js will actually read', () => {
    // ⚠️ The guard on a **silent** failure: gtag.js walks the queue with
    // `Array.isArray` first, which routes a real array to the array-based
    // `push(['some.method', …])` form and never treats it as a command. Push an
    // array and nothing errors, nothing warns, and no event is ever sent. What
    // it accepts is an `arguments` object — or, per its own check, an array-like
    // with an own `callee`.
    loadAnalytics();

    const entry = (gtagWindow().dataLayer ?? [])[0] as Record<PropertyKey, unknown>;
    expect(Array.isArray(entry)).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(entry, 'callee')).toBe(true);
    expect(entry.length).toBe(2);
    expect(entry[0]).toBe('js');
  });

  it('loads once however many times it is asked — a second call is not a second tag', () => {
    loadAnalytics();
    loadAnalytics();
    loadAnalytics();

    expect(scripts()).toHaveLength(1);
    expect(calls()).toHaveLength(2);
  });
});

describe('a page view', () => {
  it('carries the URL and nothing else', () => {
    loadAnalytics();
    trackPageView('http://localhost:3000/123');

    const event = calls().at(-1);
    expect(event?.[0]).toBe('event');
    expect(event?.[1]).toBe('page_view');

    // ⚠️ The assertion that keeps user-submitted content out of analytics: the
    // parameter object has ONE key. A clip title, a tag or this app's anonymous
    // voter token cannot ride along without failing here.
    const params = event?.[2] as Record<string, unknown>;
    expect(Object.keys(params)).toEqual(['page_location']);
    expect(params.page_location).toBe('http://localhost:3000/123');
  });
});

describe('withdrawing', () => {
  /** A loaded tag with the cookies gtag.js would have written by now. */
  function loadedWithCookies(): void {
    loadAnalytics();
    document.cookie = '_ga=GA1.1.1234567890.1234567890; path=/';
    document.cookie = '_ga_TESTID1234=GS1.1.session; path=/';
    document.cookie = '_gid=GA1.1.99; path=/';

    // ⚠️ Not decoration: without this the assertions below would pass just as
    // happily if the cookies had never been set in the first place.
    expect(cookieNames().sort()).toEqual(['_ga', '_ga_TESTID1234', '_gid']);
  }

  it('stops the tag that is already running, takes it out, and clears its cookies', () => {
    loadedWithCookies();

    unloadAnalytics();

    // ⚠️ Removing the element does not unload the JavaScript it fetched. GA's
    // own opt-out switch is what actually stops it sending.
    expect(disableFlag()).toBe(true);
    expect(scripts()).toHaveLength(0);
    expect(gtagWindow().gtag).toBeUndefined();
    expect(gtagWindow().dataLayer).toBeUndefined();
    expect(isAnalyticsLoaded()).toBe(false);

    expect(cookieNames()).not.toContain('_ga');
    expect(cookieNames()).not.toContain('_ga_TESTID1234');
    expect(cookieNames()).not.toContain('_gid');
  });

  it('clears Google cookies only — it is not a "delete my site data" button', () => {
    loadedWithCookies();
    document.cookie = 'gravindex_unrelated=keep-me; path=/';
    expect(cookieNames()).toContain('gravindex_unrelated');

    unloadAnalytics();

    expect(cookieNames()).toEqual(['gravindex_unrelated']);
  });

  it('stops events: a page view after it reaches nothing', () => {
    loadedWithCookies();

    unloadAnalytics();
    trackPageView('http://localhost:3000/456');

    expect(gtagWindow().dataLayer).toBeUndefined();
    expect(scripts()).toHaveLength(0);
  });

  it('can be undone — accepting again clears the opt-out and reloads one tag', () => {
    loadedWithCookies();

    unloadAnalytics();
    loadAnalytics();

    expect(disableFlag()).toBe(false);
    expect(scripts()).toHaveLength(1);
    expect(isAnalyticsLoaded()).toBe(true);

    trackPageView('http://localhost:3000/');
    expect(calls().at(-1)?.[1]).toBe('page_view');
  });
});

describe('the module itself', () => {
  it('never reads the anonymous voter token, by construction', async () => {
    // ⚠️ The rule from the root `CLAUDE.md`: the voter token is a deduplication
    // hint for votes and GA4 has an identifier of its own. Joining them would
    // build a personal-data trail the schema is designed not to hold. Asserted
    // against the source because the failure mode is an import nobody notices.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');

    const here = dirname(fileURLToPath(import.meta.url));
    for (const file of ['ga4.ts', 'start-analytics.ts']) {
      const source = readFileSync(join(here, '..', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(source).not.toMatch(/voter-token|VoterToken|identity/i);
    }
  });
});
