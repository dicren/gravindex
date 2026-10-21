import { FIXTURE_FACTS, readFeedFixture, truncatedFeedFixture } from './__fixtures__/feed-fixture';
import {
  DEFAULT_COVER,
  FeedParseError,
  parseDuration,
  parseFeed,
  parsePubDate,
} from './feed-parser';

// ⚠️ No network and no database in this file. Everything runs against the saved
// copy of the feed, which is the whole reason the parser is a pure function.

// A hand-written feed is the only way to assert the paths the real one never
// takes: a missing cover, a broken date, an entry with no audio.
function feed(channelExtras: string, items: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
      <channel><title>Gravina 82</title>${channelExtras}${items}</channel>
    </rss>`;
}

function item(fields: string): string {
  return `<item>${fields}</item>`;
}

const AUDIO = '<enclosure url="https://example.invalid/a.mp3" length="1" type="audio/mpeg" />';

describe('parseFeed over the sample feed', () => {
  const parsed = parseFeed(readFeedFixture());

  // The headline number the parser exists for.
  it('finds every entry and keeps only the ones carrying audio', () => {
    expect({
      totalEntries: parsed.totalEntries,
      audioEntries: parsed.entries.length,
      withoutAudio: parsed.withoutAudio,
      malformed: parsed.malformed,
    }).toEqual({
      totalEntries: FIXTURE_FACTS.totalEntries,
      audioEntries: FIXTURE_FACTS.audioEntries,
      withoutAudio: FIXTURE_FACTS.withoutAudio,
      malformed: FIXTURE_FACTS.malformed,
    });
  });

  // `link` is the dedup key, so a repeat inside one document would silently
  // become a duplicate row if the service did not also guard against it.
  it('gives every audio entry a distinct link', () => {
    const links = new Set(parsed.entries.map((entry) => entry.originalUrl));

    expect(links.size).toBe(FIXTURE_FACTS.audioEntries);
  });

  it('maps one entry onto every column the episode table needs', () => {
    const newest = parsed.entries[0];

    expect(newest).toEqual({
      title: FIXTURE_FACTS.newest.title,
      originalUrl: FIXTURE_FACTS.newest.originalUrl,
      file: FIXTURE_FACTS.newest.file,
      date: new Date(FIXTURE_FACTS.newest.date),
      description: FIXTURE_FACTS.newest.description,
      duration: FIXTURE_FACTS.newest.duration,
    });
  });

  // ⚠️ The first entry of the sample is written with an `http://` enclosure. It
  // comes out as HTTPS: the browser streams this URL from a page served over
  // HTTPS, and mixed content is blocked, so storing it verbatim would leave the
  // episode silently unplayable.
  it('takes the mp3 from the enclosure and upgrades it to https', () => {
    const notHttpsMp3 = parsed.entries.filter((entry) => !/^https:\/\/\S+\.mp3$/.test(entry.file));

    expect(notHttpsMp3).toEqual([]);
  });

  it('leaves the link untouched, because it is the dedup key', () => {
    const notPlainSiteUrl = parsed.entries.filter(
      (entry) => !entry.originalUrl.startsWith('https://example.com/'),
    );

    expect(notPlainSiteUrl).toEqual([]);
  });

  it('parses pubDate as an absolute UTC instant', () => {
    const times = parsed.entries.map((entry) => entry.date.getTime());

    expect(new Date(Math.min(...times)).toISOString()).toBe(FIXTURE_FACTS.oldest);
    expect(new Date(Math.max(...times)).toISOString()).toBe(FIXTURE_FACTS.newest.date);
  });

  it('reads itunes:duration where the feed has one, and null where it has none', () => {
    const withDuration = parsed.entries.filter((entry) => entry.duration !== null);

    expect(withDuration.length).toBe(FIXTURE_FACTS.withDuration);
    expect(withDuration.every((entry) => Number.isInteger(entry.duration))).toBe(true);
    expect(parsed.entries.length - withDuration.length).toBe(
      FIXTURE_FACTS.audioEntries - FIXTURE_FACTS.withDuration,
    );
  });

  // The channel image is the ONLY cover the feed offers — `itunes:image`
  // appears once, at channel level, and never inside an entry.
  it('takes the cover from the channel artwork', () => {
    expect(parsed.cover).toBe(FIXTURE_FACTS.cover);
  });

  // ⚠️ WordPress writes numeric character references into titles. Left
  // undecoded they reach the database, and then the UI, as literal
  // `&#8230;`, so they must be decoded on the way in.
  it('decodes the numeric HTML entities WordPress writes into titles', () => {
    const undecoded = parsed.entries.filter((entry) => /&#\d+;/.test(entry.title));

    expect(undecoded).toEqual([]);
    expect(parsed.entries.map((entry) => entry.title)).toContain('Episodio 7 – Entrevista…');
  });

  it('never produces a value too long for its varchar(255) column', () => {
    const tooLong = parsed.entries.filter(
      (entry) =>
        entry.title.length > 255 || entry.originalUrl.length > 255 || entry.file.length > 255,
    );

    expect(tooLong).toEqual([]);
  });
});

describe('parseFeed field mapping', () => {
  it('upgrades an http enclosure but never rewrites the link', () => {
    const parsed = parseFeed(
      feed(
        '',
        item(
          '<title>x</title><link>http://example.invalid/e/</link>' +
            '<pubDate>Wed, 29 Jul 2026 18:27:27 +0000</pubDate>' +
            '<enclosure url="http://example.invalid/a.mp3" length="1" type="audio/mpeg" />',
        ),
      ),
    );

    expect(parsed.entries[0]).toMatchObject({
      file: 'https://example.invalid/a.mp3',
      originalUrl: 'http://example.invalid/e/',
    });
  });

  it('skips entries with no enclosure instead of importing them', () => {
    const parsed = parseFeed(
      feed(
        '',
        item('<title>Un post</title><link>https://example.invalid/p/</link>') +
          item(
            `<title>Un episodio</title><link>https://example.invalid/e/</link>` +
              `<pubDate>Wed, 29 Jul 2026 18:27:27 +0000</pubDate>${AUDIO}`,
          ),
      ),
    );

    expect(parsed.totalEntries).toBe(2);
    expect(parsed.withoutAudio).toBe(1);
    expect(parsed.entries.map((entry) => entry.title)).toEqual(['Un episodio']);
  });

  // A NOT NULL column is not a place to discover that a feed entry was
  // incomplete, so the entry is counted and dropped instead.
  it.each([
    [
      'no title',
      `<link>https://example.invalid/e/</link><pubDate>Wed, 29 Jul 2026 18:27:27 +0000</pubDate>${AUDIO}`,
    ],
    ['no link', `<title>x</title><pubDate>Wed, 29 Jul 2026 18:27:27 +0000</pubDate>${AUDIO}`],
    ['no pubDate', `<title>x</title><link>https://example.invalid/e/</link>${AUDIO}`],
    [
      'unparseable pubDate',
      `<title>x</title><link>https://example.invalid/e/</link><pubDate>ayer por la tarde</pubDate>${AUDIO}`,
    ],
  ])('drops an entry with %s and counts it as malformed', (_case, fields) => {
    const parsed = parseFeed(feed('', item(fields)));

    expect(parsed.entries).toEqual([]);
    expect(parsed.malformed).toBe(1);
  });

  it('accepts an entry with an empty description', () => {
    const parsed = parseFeed(
      feed(
        '',
        item(
          `<title>x</title><link>https://example.invalid/e/</link>` +
            `<pubDate>Wed, 29 Jul 2026 18:27:27 +0000</pubDate><description></description>${AUDIO}`,
        ),
      ),
    );

    expect(parsed.entries[0]?.description).toBe('');
  });
});

describe('cover fallback', () => {
  it('prefers the channel itunes:image', () => {
    const parsed = parseFeed(
      feed(
        '<itunes:image href="https://example.invalid/art.png" />' +
          '<image><url>https://example.invalid/tiny.png</url></image>',
        '',
      ),
    );

    expect(parsed.cover).toBe('https://example.invalid/art.png');
  });

  it('falls back to the channel <image><url> when there is no itunes:image', () => {
    const parsed = parseFeed(
      feed('<image><url>https://example.invalid/tiny.png</url></image>', ''),
    );

    expect(parsed.cover).toBe('https://example.invalid/tiny.png');
  });

  // ⚠️ Never empty: `cover` is NOT NULL and the UI renders it directly.
  it('falls back to the hard-coded default when the channel has no image at all', () => {
    expect(parseFeed(feed('', '')).cover).toBe(DEFAULT_COVER);
  });
});

describe('parseDuration', () => {
  it.each([
    ['1:19:18', 4758],
    ['59:24', 3564],
    ['7:55', 475],
    ['52', 52],
    ['0:00:30', 30],
  ])('reads %s as %i seconds', (raw, seconds) => {
    expect(parseDuration(raw)).toBe(seconds);
  });

  // ⚠️ Guessing at a malformed duration would put a wrong number in front of a
  // listener. "Unknown" is a supported state — the column is nullable.
  it.each([
    ['', 'empty'],
    ['0', 'zero'],
    ['00:00', 'zero-length'],
    ['abc', 'not a number'],
    ['1:2:3:4', 'four segments'],
    ['1:-2', 'negative'],
    ['1.5', 'decimal'],
  ])('returns null for %p (%s)', (raw) => {
    expect(parseDuration(raw)).toBeNull();
  });
});

describe('parsePubDate', () => {
  it('keeps the instant when the offset is not UTC', () => {
    expect(parsePubDate('Wed, 29 Jul 2026 20:27:27 +0200')?.toISOString()).toBe(
      '2026-07-29T18:27:27.000Z',
    );
  });

  it.each(['', 'ayer', '0000-00-00 00:00:00'])('returns null for %p', (raw) => {
    expect(parsePubDate(raw)).toBeNull();
  });
});

// ⚠️ The feed comes off someone else's server: a 502 HTML page, a truncated
// response or an empty body are all things that will happen eventually. None of
// them may take the scheduled job down.
describe('hostile input', () => {
  it.each([
    ['an empty body', ''],
    ['plain text', 'not xml at all'],
    ['an HTML error page', '<html><body><h1>502 Bad Gateway</h1></body></html>'],
    ['XML that is not a feed', '<atom:feed xmlns:atom="urn:x" />'],
  ])('rejects %s with a FeedParseError', (_case, input) => {
    expect(() => parseFeed(input)).toThrow(FeedParseError);
  });

  it('rejects a response truncated mid-entry rather than importing half of it', () => {
    expect(() => parseFeed(truncatedFeedFixture())).toThrow(FeedParseError);
  });

  // Valid XML with nothing in it is NOT an error — it is a feed with no
  // entries, and the run reports zero rather than failing.
  it.each([
    ['a channel with no items', feed('', '')],
    ['a self-closing channel', '<rss version="2.0"><channel /></rss>'],
  ])('accepts %s as an empty feed', (_case, input) => {
    expect(parseFeed(input)).toEqual({
      totalEntries: 0,
      entries: [],
      withoutAudio: 0,
      malformed: 0,
      cover: DEFAULT_COVER,
    });
  });
});
