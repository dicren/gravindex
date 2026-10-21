// Direct access to the application's postgres, for three jobs only:
//
//   1. proving, before and after a run, that the data is still the pristine
//      fixture;
//   2. removing the rows this suite creates, so it can be run again immediately
//      and get the same answer;
//   3. reading back what a write actually stored, which is the only witness that
//      can answer "did the seconds on screen reach the database".
//
// `docker compose exec` rather than a postgres driver: this suite adds no
// dependency to any `package.json`.

import { execFileSync } from 'node:child_process';
import {
  INGEST_DATABASE,
  PRISTINE_COUNTS,
  REPO_ROOT,
  TOKEN_SQL_PREFIX,
  WRITE_MARKER,
} from './constants';

// ⚠️ The disposable test database, never `gravindex-db` — that one ships to
// production and has no reset/reseed path left anywhere in this repo. See
// `test/testdb/testdb.sh`, which `run.sh` uses to bring this one up.
const SERVICE = process.env.E2E_DB_SERVICE ?? 'gravindex-test-db';
const DB_USER = process.env.DB_USER ?? 'gravindex';
const DB_NAME = process.env.DB_NAME ?? 'gravindex';

function run(database: string, statements: readonly string[]): string {
  const args = ['compose', 'exec', '-T', SERVICE, 'psql', '-U', DB_USER, '-d', database, '-At'];
  for (const sql of statements) args.push('-c', sql);
  return execFileSync('docker', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** One statement against the application database. */
export function psql(sql: string): string {
  return run(DB_NAME, [sql]);
}

/** One statement against the throwaway ingestion database. */
export function psqlIngest(sql: string): string {
  return run(INGEST_DATABASE, [sql]);
}

/** One statement against `postgres`, for `CREATE`/`DROP DATABASE`. */
export function psqlAdmin(sql: string): string {
  return run('postgres', [sql]);
}

export function scalar(sql: string): string {
  return psql(sql);
}

export function count(sql: string): number {
  return Number(psql(sql));
}

export function rowCounts(): Record<string, number> {
  const sql = Object.keys(PRISTINE_COUNTS)
    .map((table) => `select '${table}', count(*) from "${table}"`)
    .join(' union all ');
  const counts: Record<string, number> = {};
  for (const line of psql(sql).split('\n')) {
    const [table, value] = line.split('|');
    if (table !== undefined && value !== undefined) counts[table] = Number(value);
  }
  return counts;
}

/** Human-readable drift from the pristine fixture; empty when the data is intact. */
export function driftFromPristine(): string[] {
  const actual = rowCounts();
  return Object.entries(PRISTINE_COUNTS)
    .filter(([table, expected]) => actual[table] !== expected)
    .map(([table, expected]) => `${table}: ${actual[table]} rows, expected ${expected}`);
}

export type SequenceState = Record<string, number>;

/**
 * ⚠️ Sequences are part of the pristine state, not an implementation detail.
 * A suite that creates and deletes a clip would move the *next id* of its table
 * (clip, playback, …) while every row count looked perfect, so the next run would
 * start from a different state. Captured before the run and
 * put back after it — measured, never guessed.
 */
export function captureSequences(): SequenceState {
  const state: SequenceState = {};
  const output = psql(
    "select sequencename, last_value from pg_sequences where schemaname = 'public' and last_value is not null",
  );
  if (output === '') return state;
  for (const line of output.split('\n')) {
    const [name, value] = line.split('|');
    if (name !== undefined && value !== undefined) state[name] = Number(value);
  }
  return state;
}

export function restoreSequences(state: SequenceState): void {
  for (const [name, value] of Object.entries(state)) {
    psql(`select setval('${name}', ${value}, true)`);
  }
}

/**
 * Copy the real `episode` rows into the throwaway ingestion database.
 *
 * ⚠️ The set difference the ingestion group asserts is only meaningful against
 * the ACTUAL `originalUrl` values the catalogue holds — a hand-written fixture of
 * them would be asserting the fixture. This is a read of the real database and a
 * write to a scratch one; the real one is never touched.
 */
export function copyEpisodesToIngestDatabase(): void {
  execFileSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      SERVICE,
      'sh',
      '-c',
      `pg_dump -U ${DB_USER} -d ${DB_NAME} --data-only -t episode | ` +
        `psql -U ${DB_USER} -d ${INGEST_DATABASE} -q -v ON_ERROR_STOP=1`,
    ],
    { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  // ⚠️ `--data-only` carries explicit ids but no sequence value, so without this
  // the very first ingested row would collide with `episode.id = 1`.
  psqlIngest("select setval('episode_id_seq', (select max(id) from episode))");
}

/**
 * Delete everything this suite created, in foreign-key order.
 *
 * Every row it makes is findable: clips carry the marker in their title, tags
 * carry it in their text or hang off a marked clip, and votes carry one of the
 * synthetic tokens. ⚠️ The token clause is what makes a vote on a REAL clip
 * removable without touching the votes that were already there — every fixture row
 * has `token is null`.
 */
export function cleanupWrites(): void {
  const marker = `${WRITE_MARKER}%`;
  const tokenLike = `${TOKEN_SQL_PREFIX}%`;
  const testClips = `select id from "clip" where "title" like '${marker}' or "token" like '${tokenLike}'`;

  psql(`delete from "vote" where clip_id in (${testClips}) or "token" like '${tokenLike}'`);
  psql(`delete from "playback" where clip_id in (${testClips})`);
  psql(
    `delete from "tag" where clip_id in (${testClips}) or "tag" like '${marker}' or "token" like '${tokenLike}'`,
  );
  psql(`delete from "clip" where "title" like '${marker}' or "token" like '${tokenLike}'`);
}
