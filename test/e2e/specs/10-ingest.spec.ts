// **RSS ingestion over a sample feed.**
//
// ⚠️ **A backend-level test, deliberately, and the only group here that opens no
// browser.** Ingestion has no HTTP surface at all — that is a design rule — and
// no screen anywhere shows its result. Driving it
// through a browser would mean inventing a UI that does not exist in order to
// test something that is not in one. The honest witness is the CLI's own summary
// and the rows that land in the database.
//
// ⚠️ **It runs against a throwaway database, never `gravindex`.** The inserts
// below would break the e2e suite's exact row counts, and the last assertion
// here proves the real database was not touched at all.
//
// ⚠️ **No network.** The feed is the invented copy committed at
// `packages/backend/src/ingest/__fixtures__/sample-feed.xml`, served over
// loopback. Nothing in this suite requests a real podcast feed.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INGEST_DATABASE, REPO_ROOT } from '../lib/constants';
import { copyEpisodesToIngestDatabase, count, psqlAdmin, psqlIngest } from '../lib/db';
import { expect, test } from '../lib/fixtures';

const FEED_FIXTURE = resolve(REPO_ROOT, 'packages/backend/src/ingest/__fixtures__/sample-feed.xml');
/** The episodes the throwaway database starts with: a copy of the fixture's rows. */
const EPISODES_BEFORE = 395;
/** What `sample-feed.xml` contains (see `feed-fixture.ts`, `FIXTURE_FACTS`). */
const FEED_ENTRIES = 6;
const FEED_AUDIO_ENTRIES = 5;
const FEED_WITHOUT_AUDIO = 1;
/** The newest entry of the sample. The test stores it first, as an earlier import would. */
const ALREADY_STORED_LINK = 'https://example.com/podcast/episodio-8/';

interface IngestSummary {
  entries: number;
  withoutAudio: number;
  inserted: number;
  alreadyPresent: number;
  duplicateLinks: number;
  malformed: number;
  error?: string;
}

/** Serve the saved feed on loopback and run the ingestion CLI against it. */
async function runIngest(): Promise<IngestSummary> {
  const xml = readFileSync(FEED_FIXTURE);
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' });
    response.end(xml);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no feed port');

  try {
    const output = await new Promise<string>((done, fail) => {
      // ⚠️ `spawn`, never `spawnSync`: the feed server above lives in THIS
      // process's event loop, and a synchronous child would block it — the CLI
      // would then time out fetching a feed nobody was left to serve.
      // ⚠️ `--skip-waveforms`, and it is not an optimisation. The CLI chains a
      // capped waveform top-up after the ingest, the same one the nightly tick
      // runs — and that step DOWNLOADS episode mp3s from the feed's hosts, which
      // this group must never do. It also prints a second JSON summary of its
      // own, which is what used to reach the parse below.
      const child = spawn('node', ['dist/ingest/ingest.cli.js', '--skip-waveforms'], {
        // ⚠️ The backend's own directory: MikroORM discovers entities through a
        // glob relative to the working directory, and from anywhere else the CLI
        // dies with "No entities were discovered".
        cwd: resolve(REPO_ROOT, 'packages/backend'),
        env: {
          ...process.env,
          DB_NAME: INGEST_DATABASE,
          INGEST_FEED_URL: `http://127.0.0.1:${address.port}/feed.xml`,
        },
      });
      let text = '';
      child.stdout.on('data', (chunk: Buffer) => (text += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (text += chunk.toString()));
      child.on('error', fail);
      child.on('close', () => done(text));
    });

    // ⚠️ Anchored to whole lines, not `/\{[\s\S]*\}/`. The summary is
    // pretty-printed, so it is the only thing in this output that opens with a
    // brace at column zero and closes with one. The greedy version spanned from
    // the FIRST brace to the LAST, so the day the CLI printed a second object
    // this stopped being a parse failure anyone could read — it became
    // `SyntaxError: Unexpected non-whitespace character after JSON at position
    // 155`, which names neither the CLI nor the extra output.
    const json = /^\{[\s\S]*?^\}/m.exec(output);
    if (json === null) throw new Error(`the ingestion CLI printed no summary:\n${output}`);
    return JSON.parse(json[0]) as IngestSummary;
  } finally {
    server.close();
  }
}

test.describe('episode ingestion from the RSS feed', () => {
  test.beforeAll(() => {
    psqlAdmin(`drop database if exists ${INGEST_DATABASE}`);
    psqlAdmin(`create database ${INGEST_DATABASE}`);
  });

  test.afterAll(() => {
    psqlAdmin(`drop database if exists ${INGEST_DATABASE}`);
  });

  test('imports the new sample episodes and skips the one already stored', async () => {
    // The real schema, from the real migrations.
    await new Promise<void>((done, fail) => {
      const child = spawn('npm', ['run', 'migration:up', '-w', 'packages/backend'], {
        cwd: REPO_ROOT,
        env: { ...process.env, DB_NAME: INGEST_DATABASE },
      });
      child.on('error', fail);
      child.on('close', (code) => (code === 0 ? done() : fail(new Error(`migrations: ${code}`))));
    });

    // The real rows, copied out of the test database. `originalUrl` is the dedup
    // key, so the check is only meaningful against the links the catalogue holds.
    copyEpisodesToIngestDatabase();
    expect(Number(psqlIngest('select count(*) from episode'))).toBe(EPISODES_BEFORE);

    // One sample entry is already in the catalogue, stored by an earlier import
    // with its own title and file. Ingestion must leave that row alone.
    psqlIngest(
      `insert into episode (title, cover, file, original_url, date, description) values ` +
        `('Importado antes', 'https://example.com/earlier-import/cover.png', ` +
        `'https://media.example.com/earlier-import/episodio-8.mp3', '${ALREADY_STORED_LINK}', ` +
        `'2024-10-28 18:00:00+00', '')`,
    );

    const summary = await runIngest();

    expect(summary.error).toBeUndefined();
    expect(summary.malformed).toBe(0);
    expect(summary.entries).toBe(FEED_ENTRIES);
    expect(summary.withoutAudio).toBe(FEED_WITHOUT_AUDIO);
    expect(summary.inserted).toBe(FEED_AUDIO_ENTRIES - 1);
    expect(summary.alreadyPresent).toBe(1);
    expect(summary.entries - summary.withoutAudio).toBe(summary.inserted + summary.alreadyPresent);

    expect(Number(psqlIngest('select count(*) from episode'))).toBe(
      EPISODES_BEFORE + 1 + (FEED_AUDIO_ENTRIES - 1),
    );
    expect(
      psqlIngest(`select title from episode where original_url = '${ALREADY_STORED_LINK}'`),
    ).toBe('Importado antes');

    // Every new row is usable: a title, a playable https file and a link.
    expect(
      Number(
        psqlIngest(
          `select count(*) from episode where id > ${EPISODES_BEFORE} and ` +
            `(title = '' or file = '' or original_url = '' or file not like 'https://%')`,
        ),
      ),
    ).toBe(0);

    // ⚠️ And the real database is exactly where it was.
    expect(count('select count(*) from episode')).toBe(EPISODES_BEFORE);
  });

  test('running it again inserts nothing', async () => {
    const summary = await runIngest();
    expect(summary.error).toBeUndefined();
    expect(summary.inserted).toBe(0);
    expect(summary.alreadyPresent).toBe(FEED_AUDIO_ENTRIES);
    expect(Number(psqlIngest('select count(*) from episode'))).toBe(
      EPISODES_BEFORE + FEED_AUDIO_ENTRIES,
    );
    expect(count('select count(*) from episode')).toBe(EPISODES_BEFORE);
  });
});
