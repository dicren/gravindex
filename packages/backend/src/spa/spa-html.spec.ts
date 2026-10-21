import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { escapeHtml, injectSocialMeta, matchSpaRoute, renderSocialMeta } from './spa-html';

// No Nest, no database, no filesystem: the string work that decides whether a
// shared link renders or breaks is a pure function, so it is tested as one.
//
// ⚠️ With ONE deliberate exception at the bottom of this file, which reads the
// frontend's real `index.html` off disk. That file is the only input this code
// ever gets in production, and the one input none of the fixtures resembled.

const SOCIAL = {
  title: 'Un clip | Índice gravinero',
  description: 'Clip de Un episodio',
  image: 'https://gravina82.com/cover.jpg',
  url: 'https://indice.example.test/42',
};

describe('escapeHtml', () => {
  it('escapes every character that can break out of an attribute', () => {
    expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('escapes the ampersand first, so the escapes do not escape each other', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
    expect(escapeHtml('Tom & "Jerry" <b>')).toBe('Tom &amp; &quot;Jerry&quot; &lt;b&gt;');
  });

  it('leaves accented Spanish alone — it is not an escaping problem', () => {
    expect(escapeHtml('Canción de cuña, ¿eh?')).toBe('Canción de cuña, ¿eh?');
  });
});

describe('matchSpaRoute', () => {
  it('reads a clip permalink', () => {
    expect(matchSpaRoute('/42')).toEqual({ kind: 'clip', id: 42 });
  });

  it('reads an episode, taking ONLY the leading integer of the slug', () => {
    expect(matchSpaRoute('/episode/12-algun-titulo')).toEqual({ kind: 'episode', id: 12 });
    expect(matchSpaRoute('/episode/12-anything')).toEqual({ kind: 'episode', id: 12 });
    expect(matchSpaRoute('/episode/12-')).toEqual({ kind: 'episode', id: 12 });
    expect(matchSpaRoute('/episode/12')).toEqual({ kind: 'episode', id: 12 });
  });

  it('treats every other path as generic', () => {
    for (const path of [
      '/',
      '/about',
      '/episodes',
      '/creator/12-algo',
      '/episode/algo',
      '/episode/12/extra',
      '/42/extra',
      '/4 2',
    ]) {
      expect(matchSpaRoute(path)).toEqual({ kind: 'other' });
    }
  });

  it('refuses an id too large for the int4 column instead of asking postgres', () => {
    expect(matchSpaRoute('/99999999999999999')).toEqual({ kind: 'other' });
    expect(matchSpaRoute('/999999999')).toEqual({ kind: 'clip', id: 999999999 });
  });
});

describe('renderSocialMeta', () => {
  it('escapes into every attribute it writes', () => {
    const html = renderSocialMeta({
      ...SOCIAL,
      title: '"<b>" & más',
      description: 'Clip de <i>algo</i>',
    });

    expect(html).toContain('<meta property="og:title" content="&quot;&lt;b&gt;&quot; &amp; más">');
    expect(html).toContain(
      '<meta property="og:description" content="Clip de &lt;i&gt;algo&lt;/i&gt;">',
    );
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<i>');
  });

  it('uses property= on the Twitter tags', () => {
    expect(renderSocialMeta(SOCIAL)).toContain('<meta property="twitter:card"');
  });
});

describe('injectSocialMeta', () => {
  const shell = [
    '<!doctype html>',
    '<html lang="es">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <title>Índice gravinero</title>',
    '    <meta name="description" content="generic" />',
    '    <meta property="og:title" content="generic" />',
    '    <meta property="twitter:card" content="summary" />',
    '  </head>',
    '  <body><div id="app"></div></body>',
    '</html>',
  ].join('\n');

  it('REPLACES the generic tags rather than adding a second set', () => {
    const html = injectSocialMeta(shell, SOCIAL);

    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html.match(/property="og:title"/g)).toHaveLength(1);
    expect(html.match(/property="twitter:card"/g)).toHaveLength(1);
    expect(html.match(/name="description"/g)).toHaveLength(1);
    expect(html).not.toContain('content="generic"');
  });

  it('leaves everything outside the head alone', () => {
    const html = injectSocialMeta(shell, SOCIAL);

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<meta charset="UTF-8" />');
    expect(html).toContain('<body><div id="app"></div></body>');
  });

  it('keeps the charset declaration above the block, inside the first 1024 bytes', () => {
    const html = injectSocialMeta(shell, SOCIAL);
    const charset = html.indexOf('<meta charset=');

    expect(charset).toBeGreaterThan(-1);
    expect(charset).toBeLessThan(html.indexOf('<!-- gravindex:social -->'));
    expect(Buffer.byteLength(html.slice(0, charset), 'utf8')).toBeLessThan(1024);
  });

  it('still injects into a head that declares no charset', () => {
    const noCharset = '<html><head><title>x</title></head><body></body></html>';

    expect(injectSocialMeta(noCharset, SOCIAL)).toContain('property="og:title"');
  });

  it('serves a document with no <head> unchanged instead of failing', () => {
    const headless = '<html><body><div id="app"></div></body></html>';

    expect(injectSocialMeta(headless, SOCIAL)).toBe(headless);
  });
});

// ── Structural assertions ────────────────────────────────────────────────────
//
// ⚠️ Deliberately NOT substring checks. `expect(html).toContain('og:title')`
// passes just as happily on a document whose `<body>` was swallowed by an
// unterminated comment — which is precisely the shape of the bug that shipped.
// These assert on the SHAPE of the result instead.

/** The document with every properly closed comment removed. */
function withoutComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

function countOf(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length;
}

/**
 * Everything a visitor needs is present AND outside every comment, and no
 * comment marker is left dangling.
 */
function expectWellFormed(html: string): void {
  expect(countOf(html, /<!--/g)).toBe(countOf(html, /-->/g));

  const bare = withoutComments(html);

  // If a `-->` had been eaten, `withoutComments` would leave the survivors
  // behind and the rest of the document inside a comment that never closes.
  expect(bare).not.toContain('<!--');
  expect(bare).not.toContain('-->');

  expect(bare).toMatch(/<body\b/i);
  expect(bare).toMatch(/<\/body\s*>/i);
  expect(bare).toMatch(/<\/html\s*>/i);
  expect(bare).toContain('<div id="app">');
  expect(bare).toMatch(/<script\b[^>]*\btype="module"/i);
}

describe('injectSocialMeta over a document that talks about its own markup', () => {
  // ⚠️ The exact shape that served a blank page in production: a comment naming
  // a tag in prose, above the real one. `TITLE_TAG` matched from inside the
  // comment through to the real `</title>`, deleting the comment's `-->` on the
  // way; the unterminated comment then swallowed the `<body>` and the module
  // script. It broke only on a direct load of a shared link, and only for
  // humans — a crawler was still served a perfectly good `<head>`.
  const shell = [
    '<!doctype html>',
    '<html lang="es">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <link rel="icon" href="/gravicon.ico" />',
    '',
    '    <!--',
    '      A long explanatory comment, of the kind a helpful person writes.',
    '      It mentions the <title> tag and the <meta property="og:title"> tags',
    '      in prose, because that is what it is explaining. None of it is markup.',
    '    -->',
    '    <title>Índice gravinero</title>',
    '    <meta name="description" content="generic" />',
    '    <meta property="og:title" content="generic" />',
    '    <script type="module" crossorigin src="/assets/app-abc123.js"></script>',
    '  </head>',
    '  <body>',
    '    <div id="app"></div>',
    '  </body>',
    '</html>',
  ].join('\n');

  it('returns a well-formed document instead of one truncated at the comment', () => {
    expectWellFormed(shell);
    expectWellFormed(injectSocialMeta(shell, SOCIAL));
  });

  it('leaves the comment itself byte-for-byte intact', () => {
    const html = injectSocialMeta(shell, SOCIAL);

    expect(html).toContain('It mentions the <title> tag and the <meta property="og:title"> tags');
    expect(html).toContain('      in prose, because that is what it is explaining.');
  });

  it('still replaces the REAL title and the REAL generic tags, exactly once each', () => {
    const html = injectSocialMeta(shell, SOCIAL);
    const head = withoutComments(html);

    expect(countOf(head, /<title>/g)).toBe(1);
    expect(head).toContain(`<title>${SOCIAL.title}</title>`);
    expect(countOf(head, /property="og:title"/g)).toBe(1);
    expect(countOf(head, /name="description"/g)).toBe(1);
    expect(head).not.toContain('content="generic"');
  });

  it('adds exactly its own two markers and disturbs no other comment', () => {
    const html = injectSocialMeta(shell, SOCIAL);

    expect(countOf(html, /<!--/g)).toBe(countOf(shell, /<!--/g) + 2);
    expect(html).toContain('<!-- gravindex:social -->');
    expect(html).toContain('<!-- /gravindex:social -->');
  });

  it('survives a comment that is already unterminated rather than compounding it', () => {
    // Not a document anyone should ship, but the injector must not make it
    // worse — and must certainly not delete the body while trying.
    const broken = shell.replace('    -->', '    (oops, never closed)');
    const html = injectSocialMeta(broken, SOCIAL);

    expect(html).toContain('<div id="app"></div>');
    expect(html).toContain('<script type="module"');
  });

  it('ignores a <title> outside the head, such as one inside an inline <svg>', () => {
    const withSvg = shell.replace(
      '    <div id="app"></div>',
      '    <div id="app"></div>\n    <svg><title>Un icono</title></svg>',
    );
    const html = injectSocialMeta(withSvg, SOCIAL);

    expectWellFormed(html);
    expect(html).toContain('<svg><title>Un icono</title></svg>');
    expect(html).toContain(`<title>${SOCIAL.title}</title>`);
  });
});

describe('injectSocialMeta against the frontend’s REAL index.html', () => {
  // ⚠️ The file itself, off disk, not a fixture — this is the gap that let the
  // blank page through. Every other test in this file runs on a shell written
  // to match the code; production only ever runs on this one, and it looked
  // nothing like the fixtures. A moved monorepo layout makes this fail loudly,
  // which is correct: an injector with nothing real to inject into is untested.
  const INDEX_HTML = resolve(__dirname, '..', '..', '..', 'frontend', 'index.html');
  const source = readFileSync(INDEX_HTML, 'utf8');

  it('starts from a document that is itself well-formed', () => {
    expectWellFormed(source);
  });

  it('produces a well-formed document with the body and the module script intact', () => {
    expectWellFormed(injectSocialMeta(source, SOCIAL));
  });

  it('keeps every script and link the build put there', () => {
    const html = injectSocialMeta(source, SOCIAL);

    expect(countOf(html, /<script\b/g)).toBe(countOf(source, /<script\b/g));
    expect(countOf(html, /<link\b/g)).toBe(countOf(source, /<link\b/g));
  });

  it('replaces the single real <title> and adds one set of social tags', () => {
    const html = withoutComments(injectSocialMeta(source, SOCIAL));

    expect(countOf(html, /<title>/g)).toBe(1);
    expect(html).toContain(`<title>${SOCIAL.title}</title>`);
    expect(countOf(html, /property="og:title"/g)).toBe(1);
    expect(countOf(html, /property="og:url"/g)).toBe(1);
  });

  it('leaves the charset declaration inside the first 1024 bytes, injected and all', () => {
    // ⚠️ **The constraint the whole insertion point is arranged around, checked
    // at last against the document that actually ships.** The block goes in
    // right behind the charset because the block itself exceeds the 1024 bytes
    // the spec gives a charset declaration to appear in; what nothing measured
    // until now is the charset's own offset in the REAL file, which grows every
    // time somebody adds a line to the head — as the PWA's Apple icon tags did.
    const html = injectSocialMeta(source, SOCIAL);
    const charsetAt = html.indexOf('<meta charset=');

    expect(charsetAt).toBeGreaterThanOrEqual(0);
    expect(Buffer.byteLength(html.slice(0, charsetAt), 'utf8')).toBeLessThan(1024);
  });

  it('keeps the icon links the PWA installs from', () => {
    // The manifest link is injected into the BUILD by `vite-plugin-pwa` and is
    // therefore not in this file; the Apple ones are, because iOS reads them
    // from the document. An injector that ate a `<link>` would make the app
    // uninstallable on a phone and nothing else would notice.
    const html = injectSocialMeta(source, SOCIAL);

    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('rel="icon"');
  });

  it('does not contain a literal tag inside a comment — defence in depth', () => {
    // The injector no longer cares, but the next person to document this file
    // should not be able to hand a regex something that looks like markup.
    const comments = source.match(/<!--[\s\S]*?-->/g) ?? [];

    expect(comments.length).toBeGreaterThan(0);
    for (const comment of comments) {
      expect(comment).not.toMatch(/<\/?(?:title|meta|script|body|head)\b/i);
    }
  });
});
