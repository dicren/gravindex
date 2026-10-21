// Pure string work: no Nest, no database, no filesystem. Everything here is a
// function of its arguments, which is what makes the interesting cases (the
// escaping, the route shapes) testable without booting anything.

/** What ends up in the `<head>` for a clip or an episode. */
export interface SocialMeta {
  /** Full `<title>`, already including the site suffix. */
  title: string;
  description: string;
  /** ⚠️ Absolute. Covers point at gravina82.com, so they already are. */
  image: string;
  /** ⚠️ Absolute, built from `PUBLIC_URL`. */
  url: string;
}

/** Which of the SPA's routes a request path corresponds to. */
export type SpaRoute =
  | { readonly kind: 'clip'; readonly id: number }
  | { readonly kind: 'episode'; readonly id: number }
  | { readonly kind: 'other' };

const OTHER: SpaRoute = { kind: 'other' };

// `/:id` — the clip permalink people have been sharing since 2019.
//
// ⚠️ Bounded to 9 digits on purpose: the id is a Postgres `int4`, and handing
// `/99999999999999999` straight to the query would make the driver raise
// "integer out of range" on what is, from the visitor's side, just a wrong URL.
// Anything longer is not a clip, so it falls through to the generic tags.
const CLIP_PATH = /^\/(\d{1,9})$/;

// `/episode/<id>-<slug>` — ⚠️ ONLY the leading integer is parsed, exactly like
// the SPA's own route does. The slug is decoration: `/episode/12-anything`,
// `/episode/12-` and `/episode/12` all address episode 12.
const EPISODE_PATH = /^\/episode\/(\d{1,9})(?:-[^/]*)?$/;

/**
 * Classify a request path. Everything that is not a clip or an episode is
 * `other` and gets `index.html` untouched, with whatever generic tags the build
 * already carries.
 */
export function matchSpaRoute(pathname: string): SpaRoute {
  const clip = CLIP_PATH.exec(pathname);
  if (clip?.[1]) {
    return { kind: 'clip', id: Number(clip[1]) };
  }

  const episode = EPISODE_PATH.exec(pathname);
  if (episode?.[1]) {
    return { kind: 'episode', id: Number(episode[1]) };
  }

  return OTHER;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escape a value for use inside a double-quoted HTML attribute.
 *
 * ⚠️ Not optional and not cosmetic. Clip and episode titles are submitted by
 * anonymous visitors with no account and no moderation queue: a `"` closes the
 * `content` attribute, a `<` opens a tag, and the pair is a script-injection
 * vector against everyone who opens the link. `&` goes first or the escapes
 * would escape each other.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

// ⚠️ Regex over HTML, deliberately and narrowly. The alternative is a real
// parser (a dependency, plus a serialization round-trip over a file we did not
// write), and the job is small enough not to need one: find the `<head>`, drop
// the tags we are about to replace, insert ours. Anything unrecognised is left
// exactly as it was.
const HEAD_OPEN = /<head\b[^>]*>/i;
const HEAD_CLOSE = /<\/head\s*>/i;
const CHARSET_META = /<meta\b[^>]*\bcharset\b[^>]*>/i;
const TITLE_TAG = /[^\S\n]*<title\b[^>]*>[\s\S]*?<\/title>\s*/i;
const REPLACED_META =
  /[^\S\n]*<meta\b[^>]*\b(?:property|name)\s*=\s*["'](?:og:|twitter:|article:|description)[^"']*["'][^>]*>\s*/gi;

// ⚠️ A comment is CONTENT, and none of the patterns above may read it as markup.
//
// This is not hypothetical. `index.html` documents itself, and one of those
// comments explained — in prose — that the `<title>` is injected here. `TITLE_TAG`
// matched that mention and ran on to the REAL `</title>` further down, deleting
// the comment's own `-->` on the way. The now-unterminated comment swallowed the
// `<body>` and the module script, and the shell served a blank page.
//
// It failed in the worst possible shape: only on a direct load of a shared link
// (client-side navigation never asks the backend), and only for humans (a
// crawler reads the `<head>` it was given and is perfectly happy) — so nothing
// reported it and no dev-server test could see it.
//
// The defence is to match against a copy in which a comment cannot say anything:
// same length, same line breaks, every other character replaced by a NUL that no
// pattern here can match. Offsets stay valid, so every cut is made on the
// ORIGINAL string and the comments themselves come through untouched.
//
// ⚠️ The mask is NUL, not a space: the patterns above end in `\s*`, so masking
// with whitespace would let a cut run *into* a comment and delete part of it —
// one silent corruption traded for another. NUL matches nothing here.
// `(?:-->|$)` masks an already-unterminated comment to the end of the document
// instead of pretending it closed.
const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const MASK = '\u0000';

function maskComments(html: string): string {
  return html.replace(HTML_COMMENT, (comment) => comment.replace(/[^\n]/g, MASK));
}

/** A half-open `[start, end)` slice of the document that is about to be removed. */
interface Cut {
  readonly start: number;
  readonly end: number;
}

function findCuts(pattern: RegExp, value: string): Cut[] {
  const found = pattern.global ? [...value.matchAll(pattern)] : [pattern.exec(value)];

  return found
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ start: match.index, end: match.index + match[0].length }));
}

/**
 * `value` with `cuts` (sorted by `start`) removed.
 *
 * ⚠️ Overlapping cuts are merged, never skipped: a removed `<meta>`'s trailing
 * whitespace is also the following `<title>`'s leading whitespace, and dropping
 * the second cut because it starts inside the first would leave the document
 * with two titles.
 */
function applyCuts(value: string, cuts: readonly Cut[]): string {
  let out = '';
  let at = 0;

  for (const cut of cuts) {
    if (cut.start > at) {
      out += value.slice(at, cut.start);
    }
    at = Math.max(at, cut.end);
  }

  return out + value.slice(at);
}

const SOCIAL_BLOCK_OPEN = '<!-- gravindex:social -->';
const SOCIAL_BLOCK_CLOSE = '<!-- /gravindex:social -->';

function meta(attribute: 'property' | 'name', key: string, content: string): string {
  return `    <meta ${attribute}="${key}" content="${escapeHtml(content)}">`;
}

/**
 * Render the block injected into the `<head>`.
 *
 * ⚠️ The `twitter:*` tags use `property=` and not `name=`, which looks wrong
 * against the Twitter Cards documentation and is not: it is a deliberate choice
 * for the social previews, and it stays unless those previews are re-tested.
 */
export function renderSocialMeta(social: SocialMeta): string {
  return [
    SOCIAL_BLOCK_OPEN,
    `    <title>${escapeHtml(social.title)}</title>`,
    meta('name', 'description', social.description),
    meta('property', 'og:title', social.title),
    meta('property', 'og:description', social.description),
    meta('property', 'og:image', social.image),
    meta('property', 'og:url', social.url),
    meta('property', 'og:site_name', 'Índice gravinero'),
    meta('property', 'og:locale', 'es_ES'),
    meta('property', 'og:type', 'article'),
    meta('property', 'twitter:card', 'summary_large_image'),
    meta('property', 'twitter:title', social.title),
    meta('property', 'twitter:description', social.description),
    meta('property', 'twitter:image', social.image),
    meta('property', 'twitter:site', '@gravina82'),
    meta('property', 'twitter:creator', '@gravina82'),
    `    ${SOCIAL_BLOCK_CLOSE}`,
  ].join('\n');
}

/**
 * Put `social` into `html`'s `<head>`, replacing the generic tags the build
 * ships rather than sitting next to them — duplicated `og:title`s are read
 * inconsistently by crawlers, and "whichever one wins" is not a contract.
 *
 * Returns the document unchanged when it has no `<head>` at all: an odd
 * `index.html` is not a reason to stop serving the SPA.
 */
export function injectSocialMeta(html: string, social: SocialMeta): string {
  // Everything below is matched against the comment-masked copy and cut out of
  // the real one, so no prose in `index.html` can ever be mistaken for markup.
  const masked = maskComments(html);

  const open = HEAD_OPEN.exec(masked);
  if (!open) {
    return html;
  }

  // ⚠️ Bounded by `</head>` as well. A `<title>` inside an inline `<svg>`, or an
  // `og:` tag some other tool wrote into the body, belongs to whoever put it
  // there — the replacement is a `<head>` operation and stays one.
  const start = open.index + open[0].length;
  const close = HEAD_CLOSE.exec(masked.slice(start));
  const end = close ? start + close.index : html.length;

  const head = html.slice(start, end);
  const maskedHead = masked.slice(start, end);

  const cuts = [...findCuts(REPLACED_META, maskedHead), ...findCuts(TITLE_TAG, maskedHead)].sort(
    (a, b) => a.start - b.start,
  );

  const stripped = applyCuts(head, cuts);
  const strippedMask = applyCuts(maskedHead, cuts);

  // ⚠️ AFTER the charset declaration, not straight after `<head>`. The HTML
  // spec only honours a `<meta charset>` found in the document's first 1024
  // bytes, and this block is bigger than that on its own — inserting above it
  // would push it out of the window and mojibake every accented title in the
  // tags we just wrote. Falls back to the top of the head when there is none.
  const charset = CHARSET_META.exec(strippedMask);
  const at = charset ? charset.index + charset[0].length : 0;

  return [
    html.slice(0, start),
    stripped.slice(0, at),
    '\n',
    renderSocialMeta(social),
    '\n',
    stripped.slice(at).replace(/^\s*\n/, ''),
    html.slice(end),
  ].join('');
}
