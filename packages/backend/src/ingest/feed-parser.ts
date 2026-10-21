import { XMLParser } from 'fast-xml-parser';

// Pure parsing of the gravina82 WordPress/podcast RSS feed. ⚠️ No HTTP, no
// database, no Nest: everything here is a function of a string, which is what
// makes the whole mapping testable against a saved fixture
// (`__fixtures__/sample-feed.xml`) instead of against a third party's server.
//
// The feed is read rather than the HTML: a feed is a contract, while a theme's
// CSS classes are not.

// ⚠️ The one field the feed has no per-entry answer for. `itunes:image` exists
// only at channel level, so every episode ingested from the feed shares the
// podcast's artwork. This is the last resort if even that is missing — the
// podcast's own artwork URL, so a cover-less episode looks like a default rather
// than a broken image.
export const DEFAULT_COVER =
  'https://gravina82.com/wp-content/uploads/2019/03/GRAVINA82_1400PX-281844_222x180.png';

// One `<item>` that carries audio and every field the `episode` table needs.
export interface FeedEntry {
  title: string;
  // `<link>`, the episode's page. ⚠️ Also the ingestion dedup key, so that the
  // rows already stored still match and are not re-imported.
  originalUrl: string;
  // `<enclosure url>`, the remote mp3 the browser streams.
  file: string;
  date: Date;
  description: string;
  // `<itunes:duration>` in seconds, or null when the entry omits it.
  duration: number | null;
}

export interface ParsedFeed {
  // Every `<item>`, audio or not.
  totalEntries: number;
  // The entries that became episodes.
  entries: FeedEntry[];
  // Entries with no `<enclosure>`: blog posts, not episodes. Skipped by design.
  withoutAudio: number;
  // Entries with an enclosure but no usable title, link or pubDate. Skipped so
  // a broken row never reaches a NOT NULL column.
  malformed: number;
  // Channel-level artwork — see DEFAULT_COVER.
  cover: string;
}

// Thrown when the document is not an RSS feed at all (empty body, an HTML error
// page, XML the parser cannot read). ⚠️ Distinct from "a feed with zero usable
// entries", which is a valid — if suspicious — result and returns normally.
export class FeedParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeedParseError';
  }
}

// ⚠️ `parseTagValue: false` is load-bearing. Left on, fast-xml-parser coerces
// anything numeric-looking: `<itunes:duration>52</itunes:duration>` would come
// back as a number and an all-digits episode title would stop being a string.
// Everything is read as text and converted deliberately below.
//
// ⚠️ `htmlEntities: true` is not decoration either. WordPress writes titles
// with NUMERIC character references (`&#8230;`, `&#038;`, `&#034;`), which
// `processEntities` alone leaves untouched — titles like these would
// reach the database, and the UI, reading literally `actualidad&#8230;o no`.
// A parser that decodes entities on the way out does not have this problem.
//
// `isArray` pins `<item>` to an array so a feed with exactly one entry parses
// like a feed with hundreds. Every other repeated tag (`<category>`, the two
// channel-level `<image>` blocks) already becomes an array by repetition, and
// `firstOf` copes either way.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  htmlEntities: true,
  isArray: (_name, jpath) => jpath === 'rss.channel.item',
});

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

// A tag that appears once is a value; the same tag repeated is an array. Both
// shapes arrive from the same parser, so every read goes through here.
function firstOf(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

// Text content of a tag, whether it came back bare or as `{ '#text': … }`
// (which happens as soon as the tag also carries attributes).
function text(value: unknown): string {
  const node = firstOf(value);
  if (typeof node === 'string') {
    return node.trim();
  }
  const inner = asRecord(node)?.['#text'];
  return typeof inner === 'string' ? inner.trim() : '';
}

function attribute(value: unknown, name: string): string {
  const raw = asRecord(firstOf(value))?.[`@_${name}`];
  return typeof raw === 'string' ? raw.trim() : '';
}

// `itunes:duration` is spec'd as `HH:MM:SS`, `MM:SS` or plain seconds, and this
// feeds use all three in practice. Anything else — an empty tag,
// `--`, four segments — is not worth guessing at and becomes null.
export function parseDuration(raw: string): number | null {
  const parts = raw.trim().split(':');
  if (parts.length === 0 || parts.length > 3) {
    return null;
  }

  let seconds = 0;
  for (const part of parts) {
    if (!/^\d{1,6}$/.test(part)) {
      return null;
    }
    seconds = seconds * 60 + Number(part);
  }

  // A zero-length episode is missing information, not a fact about the audio.
  return seconds > 0 ? seconds : null;
}

// ⚠️ **Enclosure URLs are often written as plain `http://`**, and the
// browser streams that URL directly from a page served over HTTPS — which every
// modern browser blocks as mixed content. Stored verbatim, half the catalogue
// would simply not play, silently, with the error only in the console.
//
// Upgrading the scheme is safe in a way few normalizations are: an `http://`
// media URL is already unusable from the app, so the worst case is trading a
// guaranteed block for a request that might fail. It does not — `media.blubrry.com`
// answers over HTTPS (verified: 302 to the site's own HTTPS URL, with
// `Access-Control-Allow-Origin: *`).
//
// ⚠️ ONLY the enclosure. `link` is the dedup key that has to keep matching the
// rows already stored, so it is kept exactly as the feed writes it.
function toHttps(url: string): string {
  return url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url;
}

// `pubDate` is RFC 2822 with an explicit offset (`+0000` throughout this feed),
// so the parsed Date is an absolute instant and lands in `timestamptz` as UTC
// regardless of the machine's zone.
export function parsePubDate(raw: string): Date | null {
  if (!raw) {
    return null;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Preference order for the cover: the podcast artwork the iTunes namespace
// declares, then whatever `<image><url>` the channel offers, then the default.
function readChannelCover(channel: Record<string, unknown>): string {
  const itunesImage = attribute(channel['itunes:image'], 'href');
  if (itunesImage) {
    return itunesImage;
  }

  const images = channel.image;
  for (const image of Array.isArray(images) ? images : [images]) {
    const url = text(asRecord(image)?.url);
    if (url) {
      return url;
    }
  }

  return DEFAULT_COVER;
}

export function parseFeed(xml: string): ParsedFeed {
  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch (cause) {
    throw new FeedParseError(
      `the feed is not parseable XML: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const rss = asRecord(firstOf(asRecord(parsed)?.rss));
  if (!rss || !('channel' in rss)) {
    throw new FeedParseError('the document has no <rss><channel> element');
  }

  // ⚠️ The element can be PRESENT and still not be a record — `<channel />`
  // parses to an empty string. That is a feed with nothing in it, which is a
  // result (zero entries), not a malformed document.
  const channel = asRecord(firstOf(rss.channel)) ?? {};

  const cover = readChannelCover(channel);
  const items = Array.isArray(channel.item) ? channel.item : [];

  const entries: FeedEntry[] = [];
  let withoutAudio = 0;
  let malformed = 0;

  for (const item of items) {
    const record = asRecord(item);
    if (!record) {
      malformed++;
      continue;
    }

    // No audio, no episode. Most items on a podcast that also runs a blog are ordinary
    // posts and they are skipped before anything else is even read.
    const file = attribute(record.enclosure, 'url');
    if (!file) {
      withoutAudio++;
      continue;
    }

    const title = text(record.title);
    const originalUrl = text(record.link);
    const date = parsePubDate(text(record.pubDate));
    if (!title || !originalUrl || !date) {
      malformed++;
      continue;
    }

    entries.push({
      title,
      originalUrl,
      file: toHttps(file),
      date,
      // WordPress puts the excerpt in `<description>` and the full post body in
      // `<content:encoded>`. The excerpt is the closer match to the site's own
      // `og:description`, and the column is never surfaced.
      description: text(record.description),
      duration: parseDuration(text(record['itunes:duration'])),
    });
  }

  return { totalEntries: items.length, entries, withoutAudio, malformed, cover };
}
