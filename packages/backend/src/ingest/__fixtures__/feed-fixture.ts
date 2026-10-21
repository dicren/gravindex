import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// An invented feed in the shape of the podcast RSS feed (`sample-feed.xml`).
// ⚠️ EVERY test reads this copy and nothing in this repository requests a feed
// at test time. The file is written by hand, with example.com URLs, so it can
// live in a public repository. A saved copy of a real third-party feed is
// git-ignored and must not be used here.
export const FEED_FIXTURE_PATH = join(__dirname, 'sample-feed.xml');

export function readFeedFixture(): string {
  return readFileSync(FEED_FIXTURE_PATH, 'utf8');
}

// A feed cut off in the middle of its second entry, as a dropped connection
// would deliver it.
export function truncatedFeedFixture(): string {
  const xml = readFeedFixture();
  const secondItem = xml.indexOf('<item>', xml.indexOf('<item>') + 1);
  return xml.slice(0, secondItem + 60);
}

// What the sample feed contains, verified by `feed-parser.spec.ts`. Kept here
// because the persistence tests assert against the same numbers and a second
// hard-coded copy of them would rot.
export const FIXTURE_FACTS = {
  totalEntries: 6,
  audioEntries: 5,
  withoutAudio: 1,
  malformed: 0,
  withDuration: 4,
  cover: 'https://example.com/podcast/cover.png',
  newest: {
    title: 'Episodio 8: el primero de la temporada',
    originalUrl: 'https://example.com/podcast/episodio-8/',
    file: 'https://media.example.com/episodio-8.mp3',
    date: '2024-10-28T18:00:00.000Z',
    description: 'Primer episodio de la temporada.',
    duration: 4758,
  },
  oldest: '2024-08-05T08:00:00.000Z',
} as const;
