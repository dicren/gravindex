// Writes `test/testdb/fixture.sql`: the synthetic catalogue the disposable test
// database is loaded with. Everything in it is invented, on purpose — the real
// catalogue belongs to a third party and to its community, and none of it may
// be committed.
//
// Deterministic: running this twice produces the same bytes, so a change to the
// fixture is always a change to this file.
//
//     node test/testdb/generate-fixture.mjs
//
// The e2e suite (`test/e2e`) asserts exact counts and a few named facts against
// this data. They are the contract this generator keeps:
//
//   - 395 episodes, 180 clips, 382 tags, 227 votes, 3648 playbacks
//     (`PRISTINE_COUNTS` in `test/e2e/lib/constants.ts`).
//   - 61 episodes carry clips, and episode 93 is the one with 11 of them.
//   - Clip ids run 1..182 with 175 and 176 missing, so the queue can be told
//     about an id that no longer resolves.
//   - 102 distinct tags. `Monográficos` is the most used (45), `Cine` is used
//     often enough to filter on, `Gazpacho` is used twice, on clips of episode 53.
//   - An episode titled "Interruptus" (search), clip titles containing
//     "canción" (search), and a calendar where 2011-12-18 holds an episode and
//     the next episode falls in 2012.

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), 'fixture.sql');

const EPISODES = 395;
const CLIPS = 180;
const TAGS = 382;
const VOTES = 227;
const PLAYBACKS = 3648;
const TAG_NAMES = 102;

const TEST_EPISODE_ID = 93;
const TEST_EPISODE_CLIPS = 11;
const TEST_EPISODE_DURATION = 4800;
const TAG_EPISODE = 53;
const INTERRUPTUS_EPISODE = 40;
const CLIP_IDS_MISSING = [175, 176];
const CLIP_ID_MAX = 182;

const SUBJECTS = [
  'la lluvia',
  'el mercado',
  'un viaje en tren',
  'la abuela',
  'el fútbol de barrio',
  'una receta',
  'la radio de madrugada',
  'el primer amor',
  'un perro llamado Tizón',
  'la feria del pueblo',
  'el examen de historia',
  'una tormenta de verano',
  'la biblioteca',
  'el concierto',
  'un mal día',
  'la mudanza',
  'el ascensor',
  'la canción del verano',
  'el río',
  'la cola del banco',
];

const TAG_VOCABULARY = [
  'Monográficos',
  'Cine',
  'Gazpacho',
  'humor',
  'política',
  'música',
  'fútbol',
  'cocina',
  'historia',
  'ciencia',
  'viajes',
  'literatura',
  'infancia',
  'familia',
  'trabajo',
  'amor',
  'miedo',
  'absurdo',
  'tecnología',
  'deporte',
  'naturaleza',
  'filosofía',
  'televisión',
  'radio',
  'pueblo',
  'ciudad',
  'noticias',
  'memoria',
  'sueño',
  'mar',
];

const DAY_MS = 24 * 60 * 60 * 1000;

function sql(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

function timestamp(ms) {
  return sql(new Date(ms).toISOString());
}

function duration(episodeId) {
  if (episodeId === TEST_EPISODE_ID) return TEST_EPISODE_DURATION;
  return 2400 + ((episodeId * 7919) % 3000);
}

// Episode dates: one every 8 to 24 days, from February 2009, so the catalogue
// runs to 2026. Then 2011-12-18 is pinned to an episode, and the next one must
// fall in 2012.
const episodeDates = [];
{
  let ms = Date.UTC(2009, 1, 1, 12);
  for (let id = 1; id <= EPISODES; id += 1) {
    episodeDates.push(ms);
    ms += (8 + ((id * 13) % 17)) * DAY_MS;
  }
  const christmas = Date.UTC(2011, 11, 18, 12);
  const index = episodeDates.findIndex((date) => date >= christmas);
  episodeDates[index] = christmas;
  const next = episodeDates[index + 1];
  const year = new Date(next).getUTCFullYear();
  if (year !== 2012) throw new Error(`the episode after 2011-12-18 falls in ${year}, not 2012`);
}

const episodes = [];
for (let id = 1; id <= EPISODES; id += 1) {
  const subject = id === INTERRUPTUS_EPISODE ? 'Interruptus' : SUBJECTS[id % SUBJECTS.length];
  episodes.push({
    id,
    title: `Episodio ${id}: ${subject}`,
    cover: `https://media.example.com/covers/${id}.png`,
    file: `https://media.example.com/audio/${id}.mp3`,
    originalUrl: `https://example.com/fixture/episodio-${id}/`,
    date: episodeDates[id - 1],
    description: `Episodio ${id} del catálogo de prueba. Trata sobre ${subject}.`,
    duration: duration(id),
  });
}

// Clip ids: 1..182 without the two that the queue suite treats as deleted.
const clipIds = [];
for (let id = 1; id <= CLIP_ID_MAX; id += 1) {
  if (!CLIP_IDS_MISSING.includes(id)) clipIds.push(id);
}
if (clipIds.length !== CLIPS) throw new Error(`expected ${CLIPS} clip ids, got ${clipIds.length}`);

// Sixty episodes besides the test one carry the other 169 clips. Episode 53 is
// one of them, because the tag `Gazpacho` lives there.
const otherEpisodes = [TAG_EPISODE];
for (let i = 1; otherEpisodes.length < 60; i += 1) {
  const id = 1 + ((i * 97) % EPISODES);
  if (id !== TEST_EPISODE_ID && !otherEpisodes.includes(id)) otherEpisodes.push(id);
}

const clips = [];
for (let k = 0; k < CLIPS; k += 1) {
  const id = clipIds[k];
  const subject = SUBJECTS[k % SUBJECTS.length];
  let episodeId;
  let start;
  let end;
  if (k < TEST_EPISODE_CLIPS) {
    episodeId = TEST_EPISODE_ID;
    start = 1740 + k * 200;
    end = start + 90 + (k % 3) * 30;
  } else {
    episodeId = otherEpisodes[(k - TEST_EPISODE_CLIPS) % otherEpisodes.length];
    start = 60 + ((k * 211) % (duration(episodeId) - 400));
    end = start + 20 + ((k * 37) % 180);
  }
  clips.push({
    id,
    title: `Momento ${id} ${subject}`,
    start,
    end,
    episodeId,
    createdAt: episodeDates[episodeId - 1] + DAY_MS + k * 60 * 1000,
  });
}

// Tags: 102 names. The first three have fixed uses (45, 20, 2); the other 99
// share the rest, three each, with 18 of them getting a fourth.
const tagNames = [...TAG_VOCABULARY];
for (let i = tagNames.length; tagNames.length < TAG_NAMES; i += 1) {
  tagNames.push(
    `${TAG_VOCABULARY[i % TAG_VOCABULARY.length]} (${Math.floor(i / TAG_VOCABULARY.length)})`,
  );
}
const tagUses = Array.from({ length: TAG_NAMES }, (_, index) => {
  if (index === 0) return 45;
  if (index === 1) return 20;
  if (index === 2) return 2;
  return index < 21 ? 4 : 3;
});
const usesTotal = tagUses.reduce((sum, uses) => sum + uses, 0);
if (usesTotal !== TAGS) throw new Error(`tag uses add up to ${usesTotal}, expected ${TAGS}`);

const tags = [];
const seenTags = new Set();
function addTag(clipId, name, createdAt) {
  const key = `${clipId}|${name}`;
  if (seenTags.has(key)) return false;
  seenTags.add(key);
  tags.push({ clipId, tag: name, createdAt });
  return true;
}

const episode53Clips = clips
  .filter((clip) => clip.episodeId === TAG_EPISODE)
  .map((clip) => clip.id);
let gazpachoPlaced = 0;
for (const clipId of episode53Clips) {
  if (gazpachoPlaced === 2) break;
  if (addTag(clipId, 'Gazpacho', Date.UTC(2019, 0, 1))) gazpachoPlaced += 1;
}
if (gazpachoPlaced !== 2) throw new Error('episode 53 needs two clips to carry Gazpacho');

for (let index = 0; index < TAG_NAMES; index += 1) {
  const name = tagNames[index];
  if (name === 'Gazpacho') continue;
  let placed = 0;
  for (let attempt = 0; placed < tagUses[index]; attempt += 1) {
    const clipId = clipIds[(attempt * 37 + index * 11) % CLIPS];
    if (addTag(clipId, name, Date.UTC(2019, 0, 1) + tags.length * 60 * 1000)) placed += 1;
  }
}

const votes = [];
for (let i = 0; i < VOTES; i += 1) {
  votes.push({
    id: i + 1,
    clipId: clipIds[(i * 29) % CLIPS],
    value: 1,
    createdAt: Date.UTC(2019, 5, 1) + i * 60 * 1000,
  });
}

const playbacks = [];
for (let i = 0; i < PLAYBACKS; i += 1) {
  playbacks.push({
    id: i + 1,
    clipId: clipIds[(i * 53) % CLIPS],
    createdAt: Date.UTC(2019, 6, 1) + i * 60 * 1000,
  });
}

if (tags.length !== TAGS) throw new Error(`placed ${tags.length} tags, expected ${TAGS}`);

const BATCH = 200;

function insert(table, columns, rows, toValues) {
  const lines = [];
  for (let start = 0; start < rows.length; start += BATCH) {
    const chunk = rows.slice(start, start + BATCH);
    const values = chunk.map((row) => `(${toValues(row).join(', ')})`).join(',\n  ');
    lines.push(
      `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES\n  ${values};`,
    );
  }
  return lines.join('\n');
}

const out = [
  '-- Synthetic catalogue for the disposable test database.',
  '-- Generated by test/testdb/generate-fixture.mjs — do not edit by hand.',
  '-- Loaded by `test/testdb/testdb.sh seed` after the migrations have run, in one transaction.',
  '',
  insert(
    'episode',
    ['id', 'title', 'cover', 'file', 'original_url', 'date', 'description', 'duration', 'waveform'],
    episodes,
    (e) => [
      e.id,
      sql(e.title),
      sql(e.cover),
      sql(e.file),
      sql(e.originalUrl),
      timestamp(e.date),
      sql(e.description),
      e.duration,
      'NULL',
    ],
  ),
  '',
  insert(
    'clip',
    ['id', 'title', 'start', 'end', 'episode_id', 'token', 'created_at'],
    clips,
    (c) => [c.id, sql(c.title), c.start, c.end, c.episodeId, 'NULL', timestamp(c.createdAt)],
  ),
  '',
  insert('tag', ['clip_id', 'tag', 'token', 'created_at'], tags, (t) => [
    t.clipId,
    sql(t.tag),
    'NULL',
    timestamp(t.createdAt),
  ]),
  '',
  insert('vote', ['id', 'clip_id', 'value', 'token', 'created_at'], votes, (v) => [
    v.id,
    v.clipId,
    v.value,
    'NULL',
    timestamp(v.createdAt),
  ]),
  '',
  insert('playback', ['id', 'clip_id', 'created_at'], playbacks, (p) => [
    p.id,
    p.clipId,
    timestamp(p.createdAt),
  ]),
  '',
  `SELECT setval('episode_id_seq', ${EPISODES});`,
  `SELECT setval('clip_id_seq', ${CLIP_ID_MAX});`,
  `SELECT setval('vote_id_seq', ${VOTES});`,
  `SELECT setval('playback_id_seq', ${PLAYBACKS});`,
  '',
].join('\n');

writeFileSync(OUT, out);
console.log(`wrote ${OUT} (${out.length} bytes)`);
