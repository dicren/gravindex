/**
 * GA4, loaded by hand. Universal Analytics no longer exists, so there is no
 * plugin to lean on and the tag is written out here.
 *
 * ⚠️ **Nothing in this module runs until somebody has said yes.** The whole
 * point of `loadAnalytics()` being a function is that the tag is not in
 * `index.html`: no `<script>`, no request to Google, no cookie exists on a page
 * whose visitor has not accepted. That is what makes the banner a real gate
 * rather than a notice posted after the fact, and it is asserted in
 * `__tests__/ga4.spec.ts` — do not move any of this to module scope, and do not
 * put a tag back in the HTML.
 *
 * ⚠️ **No id configured is a supported, silent state, not an error.** There is
 * no measurement id committed anywhere in this public repository, so this is the
 * normal state in development: `isAnalyticsConfigured()` is false, the app never
 * loads anything, and — because there would be no cookie to consent to — the
 * banner does not appear either.
 *
 * ⚠️ **The anonymous voter token must never reach this file.** It is a
 * deduplication hint for votes, deliberately random and derived from nothing
 * (root `CLAUDE.md`, "Identity"); GA4 has an identifier of its own, gated behind
 * consent. Joining the two would build exactly the personal-data trail the
 * schema is designed not to hold. Nothing here imports `#/domain/identity/...` or reads its
 * storage key, and a test fails if that changes.
 *
 * This module is deliberately **stateless**: "is it loaded?" is answered by
 * looking at the document, not by a boolean somebody has to remember to reset.
 */

/** The one host this app ever talks to for measurement. */
const GTAG_SRC = 'https://www.googletagmanager.com/gtag/js';

/**
 * Marks the element injected below, so `unloadAnalytics()` removes ours and
 * only ours, and so a test can look for it by something other than a substring
 * of a URL.
 */
const SCRIPT_MARKER = 'data-grav-analytics';

/**
 * Cookies gtag.js writes for a GA4 property: `_ga` (client id), `_ga_<STREAM>`
 * (session state) and the `_gid`/`_gat` pair. ⚠️ Deliberately a
 * whitelist of prefixes: withdrawal clears Google's cookies, never the site's
 * own storage.
 */
const GA_COOKIE = /^(_ga|_gid|_gat)/;

/** The `window` fields gtag.js installs, typed rather than reached for as `any`. */
interface GtagWindow {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
}

function analyticsWindow(): Window & GtagWindow {
  return window as Window & GtagWindow;
}

/**
 * The measurement id, or `''` when there is none.
 *
 * Read on every call rather than captured at import time: a module-level
 * constant would freeze whatever the environment looked like when the first
 * import ran, which is untestable and — with Vite's build-time substitution —
 * indistinguishable from "configured with an empty string".
 */
export function analyticsMeasurementId(): string {
  const configured: unknown = import.meta.env.VITE_GA4_ID;
  return typeof configured === 'string' ? configured.trim() : '';
}

/** Is there anything to load at all? See the header: `false` is normal. */
export function isAnalyticsConfigured(): boolean {
  return analyticsMeasurementId() !== '';
}

function findScript(): HTMLScriptElement | null {
  return document.querySelector<HTMLScriptElement>(`script[${SCRIPT_MARKER}]`);
}

/** Loaded means both halves: our tag is in the document AND `gtag` answers. */
export function isAnalyticsLoaded(): boolean {
  return findScript() !== null && typeof analyticsWindow().gtag === 'function';
}

/**
 * GA's own documented opt-out switch. ⚠️ It is what actually stops a tag that
 * has already executed: removing the `<script>` element does not unload the
 * JavaScript it brought in, so withdrawal without this would keep sending.
 */
function setDisableFlag(id: string, disabled: boolean): void {
  (window as unknown as Record<string, boolean>)[`ga-disable-${id}`] = disabled;
}

/**
 * ⚠️ **A `dataLayer` entry is only read as a gtag command when it looks like an
 * `arguments` object, and an Array is explicitly not one.** Google's published
 * snippet is `function gtag(){dataLayer.push(arguments)}`; inside gtag.js the
 * queue is walked with `Array.isArray(entry)` first — which routes a real array
 * to the array-based `push(['some.method', …])` form — and only the `else` branch
 * tests for a command, with
 * `toString.call(entry) === '[object Arguments]' || 'callee' in own props`.
 * Pushing `args` directly would therefore be dropped **silently**: no error, no
 * event, and a page view that simply never arrives.
 *
 * This builds the second of the two shapes gtag.js accepts — an array-like with
 * its own `length`, numeric keys and `callee`, which is precisely what a real
 * `arguments` object carries. That second shape exists in Google's check for
 * exactly this case (transpiled and rest-parameter code), so it is a supported
 * form rather than a trick. `Symbol.iterator` is copied from `Array.prototype`
 * for the same reason: a genuine `arguments` object is iterable.
 *
 * Verified end to end in a browser: the tag loads, `/g/collect` fires.
 */
function toGtagCommand(args: unknown[]): Record<PropertyKey, unknown> {
  const command: Record<PropertyKey, unknown> = { length: args.length, callee: undefined };
  args.forEach((value, index) => {
    command[index] = value;
  });
  command[Symbol.iterator] = Array.prototype[Symbol.iterator];
  return command;
}

/**
 * Load gtag.js and configure the property. Idempotent: called twice, the second
 * call does nothing, because the script element is the state.
 *
 * ⚠️ `send_page_view: false`. `config` would otherwise fire a page view of its
 * own, which in an SPA is the *entry* URL — and then every route change sends
 * another one from `start-analytics.ts`, so the first screen is counted twice
 * and only sometimes. One code path sends page views, and it is the router's.
 */
export function loadAnalytics(): void {
  const id = analyticsMeasurementId();
  if (id === '' || isAnalyticsLoaded()) return;

  // A previous withdrawal in this same page may have set it.
  setDisableFlag(id, false);

  const target = analyticsWindow();
  const dataLayer = (target.dataLayer ??= []);
  if (typeof target.gtag !== 'function') {
    target.gtag = (...args: unknown[]) => {
      dataLayer.push(toGtagCommand(args));
    };
  }

  const script = document.createElement('script');
  script.async = true;
  script.src = `${GTAG_SRC}?id=${encodeURIComponent(id)}`;
  script.setAttribute(SCRIPT_MARKER, '');
  document.head.appendChild(script);

  target.gtag('js', new Date());
  target.gtag('config', id, { send_page_view: false });
}

/**
 * One page view, for one URL.
 *
 * ⚠️ **The URL is the only thing sent.** No clip title, no tag, no episode
 * title, and above all no identifier of this app's own — see the header. The
 * path of a public permalink says which page was looked at; a parameter
 * carrying user-submitted content would say who wrote it.
 *
 * A no-op unless the tag is loaded, which is what makes "withdrawal stops
 * events" true of every caller at once rather than of the careful ones.
 */
export function trackPageView(pageLocation: string): void {
  if (!isAnalyticsLoaded()) return;
  analyticsWindow().gtag?.('event', 'page_view', { page_location: pageLocation });
}

/**
 * Every hostname a GA cookie could have been set on: the exact host, and each
 * parent domain (`.gravina82.com` for `indice.gravina82.com`). A cookie can only
 * be deleted from the domain it was set on, and gtag picks the registrable one —
 * which this page cannot know, so it clears the lot.
 */
function cookieDomains(hostname: string): string[] {
  const labels = hostname.split('.');
  // '' means "host-only", the form used on a bare `localhost`.
  const domains = [''];
  for (let index = 0; index < labels.length - 1; index += 1) {
    domains.push(`.${labels.slice(index).join('.')}`);
  }
  return domains;
}

/**
 * Delete what JavaScript can delete.
 *
 * ⚠️ Honest about its limits: a cookie set `HttpOnly` or on a domain this
 * document cannot address is not reachable from here, and nothing in this app
 * can promise otherwise. GA4's are neither, so in practice this clears them —
 * but the guarantee that matters is `ga-disable-<id>`, which stops new ones.
 */
function clearGoogleCookies(): void {
  const names = new Set(
    document.cookie
      .split(';')
      .map((pair) => pair.split('=')[0]?.trim() ?? '')
      .filter((name) => GA_COOKIE.test(name)),
  );

  for (const name of names) {
    for (const domain of cookieDomains(window.location.hostname)) {
      const scope = domain === '' ? '' : `; domain=${domain}`;
      document.cookie = `${name}=; path=/; max-age=0${scope}`;
    }
  }
}

/**
 * Withdraw: stop sending, take the tag out of the document, and clear what is
 * clearable. The inverse of `loadAnalytics()`, and the second half of what makes
 * the footer's "Cambiar" a real control rather than a preference nobody honours.
 */
export function unloadAnalytics(): void {
  if (!isAnalyticsLoaded()) return;

  const id = analyticsMeasurementId();
  if (id !== '') setDisableFlag(id, true);

  findScript()?.remove();

  const target = analyticsWindow();
  delete target.gtag;
  delete target.dataLayer;

  clearGoogleCookies();
}
