// **The social meta tags**, as a crawler with no JavaScript receives them.
//
// The backend injects them into `index.html` itself, so **everyone gets the same
// HTML** — which is what makes this testable at all: `curl` is the whole mechanism.
//
// ⚠️ These requests go to the BACKEND, not to the Vite dev server. The dev server
// serves the raw `index.html` with no injection whatsoever, so a test pointed at
// it would pass by finding nothing.
//
// ⚠️ The title under test contains `"`, `<`, `>` and `&` on purpose. Clip titles
// are submitted by anonymous visitors; an unescaped quote closes the attribute
// and an unescaped `<` closes the tag, and both are injection vectors against
// everyone who opens the link. The assertions below are on the **exact escaped
// strings** and on a **real parse** — never on a substring that a broken
// document would also satisfy.

import { createClip, fetchRawPage, getEpisode } from '../lib/api';
import { API_URL, TEST_EPISODE_ID, WRITE_MARKER, voterToken } from '../lib/constants';
import { expect, test } from '../lib/fixtures';

const HOSTILE_TITLE = `${WRITE_MARKER} El "mejor" clip & <script>alert(1)</script>`;
const ESCAPED_TITLE = `${WRITE_MARKER} El &quot;mejor&quot; clip &amp; &lt;script&gt;alert(1)&lt;/script&gt;`;

function metaContent(html: string, key: string): string | null {
  const pattern = new RegExp(
    `<meta (?:property|name)="${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" content="([^"]*)">`,
  );
  return pattern.exec(html)?.[1] ?? null;
}

test.describe('social previews', () => {
  let clipId = 0;
  let cover = '';

  test.beforeAll(async () => {
    // ⚠️ This whole group needs a BUILT SPA for the backend to serve and inject
    // into (`SPA_DIST_PATH`). Without one the backend answers 404 and every
    // assertion below fails for a reason that has nothing to do with meta tags.
    const shell = await fetchRawPage('/');
    if (shell.status !== 200) {
      throw new Error(
        'the backend has no SPA build to serve, so there is nothing to inject into. ' +
          'Run `npm run build -w packages/frontend`.',
      );
    }

    const episode = await getEpisode(TEST_EPISODE_ID);
    cover = episode.cover;
    clipId = await createClip({
      episode: TEST_EPISODE_ID,
      title: HOSTILE_TITLE,
      start: 10,
      end: 40,
      tags: [`${WRITE_MARKER}-meta`],
      token: voterToken('feed00000001'),
    });
  });

  test('a raw request for a clip carries og:title, og:image and og:url', async () => {
    const { status, html } = await fetchRawPage(`/${clipId}`);
    expect(status).toBe(200);

    expect(metaContent(html, 'og:title')).toBe(`${ESCAPED_TITLE} | Índice gravinero`);
    expect(metaContent(html, 'og:image')).toBe(cover);

    const url = metaContent(html, 'og:url');
    // Absolute, or every crawler ignores it.
    expect(url).toMatch(/^https?:\/\//);
    expect(url?.endsWith(`/${clipId}`)).toBe(true);

    // The Twitter half travels too, and `twitter:*` keeps `property=`.
    expect(metaContent(html, 'twitter:title')).toBe(`${ESCAPED_TITLE} | Índice gravinero`);
    expect(metaContent(html, 'twitter:image')).toBe(cover);
    expect(metaContent(html, 'og:site_name')).toBe('Índice gravinero');
  });

  test('the hostile title is escaped, character for character', async () => {
    const { html } = await fetchRawPage(`/${clipId}`);
    const head = html.slice(0, html.indexOf('</head>'));

    // ⚠️ The exact escaped forms, not a `includes('mejor')` that a broken
    // document would also pass.
    expect(head).toContain('&quot;mejor&quot;');
    expect(head).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    // And the raw forms are nowhere in the head at all.
    expect(head).not.toContain('<script>alert(1)</script>');
    expect(head).not.toContain('"mejor"');
    expect(head).toContain(`<title>${ESCAPED_TITLE} | Índice gravinero</title>`);
  });

  test('the charset declaration stays inside the first 1024 bytes', async () => {
    // ⚠️ A regression that broke accents in SILENCE: the spec only obliges a
    // browser to honour `<meta charset>` in the first 1024 bytes, and the
    // injected block alone is longer than that. Pushed past the window, every
    // title with a tilde came back as mojibake — and this catalogue is full of
    // them.
    const { html } = await fetchRawPage(`/${clipId}`);
    const charsetAt = Buffer.from(html, 'utf8').indexOf(Buffer.from('<meta charset', 'utf8'));
    expect(charsetAt).toBeGreaterThanOrEqual(0);
    expect(charsetAt).toBeLessThan(1024);
  });

  test('a real parse of the same bytes returns the original title, and runs no script', async ({
    page,
  }) => {
    // The other half of the proof: not "the string looks escaped" but "a browser
    // reading it gets the title back and executes nothing". If the escaping were
    // broken, the injected `<script>` would run here.
    const dialogs: string[] = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });

    await page.goto(`${API_URL}/${clipId}`);

    const title = await page.locator('meta[property="og:title"]').getAttribute('content');
    expect(title).toBe(`${HOSTILE_TITLE} | Índice gravinero`);
    expect(await page.title()).toBe(`${HOSTILE_TITLE} | Índice gravinero`);
    expect(await page.locator('meta[property="og:image"]').getAttribute('content')).toBe(cover);
    expect(dialogs).toEqual([]);
  });

  // ⚠️ **A regression test for a real bug this suite caught**, and the most
  // serious thing it found. It is invisible from the dev server, so nothing else
  // could have seen it.
  //
  // `injectSocialMeta` used to strip the build's generic title with
  // `/[^\S\n]*<title\b[^>]*>[\s\S]*?<\/title>\s*/i`, taking the FIRST `<title` in the
  // head. In the real `packages/frontend/index.html` the first one was inside an
  // HTML COMMENT — the note explaining that the title and og tags are not set
  // there — so the lazy match ran from inside that comment to the real
  // `</title>` and deleted the rest of the comment INCLUDING its `-->`.
  //
  // What shipped was an unterminated `<!--`, so every byte after it — the module
  // script, the modulepreloads, the stylesheets, `</head>`, `<body>` and
  // `<div id="app">` — was swallowed as comment text. The meta tags were perfect
  // and the page was blank: EVERY clip permalink and every episode URL served by
  // the backend rendered nothing, which are exactly the URLs people share. `/`
  // and `/about` were fine, because they get no injection at all.
  //
  // The injector now masks comments before it matches. ⚠️ The two assertions
  // below are deliberately about the PROPERTY (every comment closes; the app
  // boots) rather than about that one comment, because the comment itself has
  // since been reworded — the guard has to outlive the trigger.
  test('the injected document is still well formed, and the SPA boots from it', async ({
    page,
  }) => {
    const { html } = await fetchRawPage(`/${clipId}`);
    expect(html.split('<!--').length - 1).toBe(html.split('-->').length - 1);
    expect(html).toContain('</head>');
    expect(html).toContain('<div id="app">');

    await page.goto(`${API_URL}/${clipId}`);
    // ⚠️ The SAME document boots the SPA: no user-agent sniffing, no second page
    // for crawlers. The clip's own card renders underneath the meta tags.
    await expect(page.locator('.clip-hero')).toHaveCount(1);
    await expect(page.locator('.clip-hero')).toContainText(HOSTILE_TITLE);
  });

  test('an episode gets a preview too, and an unknown clip gets none of the wrong one', async () => {
    const episode = await getEpisode(TEST_EPISODE_ID);
    const forEpisode = await fetchRawPage(`/episode/${TEST_EPISODE_ID}-cualquier-slug`);
    expect(forEpisode.status).toBe(200);
    expect(metaContent(forEpisode.html, 'og:title')).toBe(`${episode.title} | Índice gravinero`);
    expect(metaContent(forEpisode.html, 'og:image')).toBe(episode.cover);

    // ⚠️ 200, not 404: the SPA has to boot in order to show its own 404, and a
    // crawler that followed a dead link still gets a valid document. It gets the
    // build's own `<title>` and NO `og:*` at all — which is the design (the build
    // ships none and the backend injects only what it can describe), even though
    // `spa.service.ts` calls them "the generic tags".
    const unknown = await fetchRawPage('/9999999');
    expect(unknown.status).toBe(200);
    expect(metaContent(unknown.html, 'og:title')).toBeNull();
    expect(unknown.html).toContain('<title>Índice gravinero</title>');
  });
});
