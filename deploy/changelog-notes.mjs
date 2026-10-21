#!/usr/bin/env node
//
// Turn one entry of the web changelog into GitHub release notes.
//
// The changelog is hand-written in
// `packages/frontend/src/vue/views/AboutView.vue` and is the only place a
// version's prose lives: `package.json` carries the number, the page carries
// what changed. A release that restated it by hand would drift the first time
// somebody edited one and not the other, so the pipeline reads it from there.
//
//     node deploy/changelog-notes.mjs 2.0.0 > release-notes.md
//
// The tag is `v2.0.0` and the changelog says `2.0.0`; both spellings are
// accepted. An unknown version is a non-zero exit on purpose: a release with
// empty notes is worse than a failed job.
//
// ⚠️ No HTML parser and no dependency. The shape is fixed by the page (one
// `<ul class="about__changelog">`, one `<li>` per version, `<strong>` for the
// number, a nested `<ul>` of bullets), and this script is the thing that would
// fail loudly if that shape ever changed. `deploy/README.md` says so.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CHANGELOG = resolve(
  import.meta.dirname,
  '..',
  'packages/frontend/src/vue/views/AboutView.vue',
);

const wanted = (process.argv[2] ?? '').replace(/^v/, '');
if (wanted === '') {
  console.error('usage: node deploy/changelog-notes.mjs <version>   (for example 2.0.0)');
  process.exit(2);
}

const html = readFileSync(CHANGELOG, 'utf8');

// The whole changelog: from the class that marks it to the `</ul>` that closes
// the outer list. The nested per-version `<ul>`s are handled below.
const blockStart = html.indexOf('<ul class="about__changelog">');
if (blockStart === -1) {
  console.error(`changelog-notes: no <ul class="about__changelog"> in ${CHANGELOG}`);
  process.exit(1);
}
const block = html.slice(blockStart);

// Each top-level entry starts with `<li>` followed by the version in a
// `<strong>`. Nested bullets never contain a `<strong>`, so splitting on that
// pair is safe and keeps every version in one chunk.
const entries = block.split(/<li>\s*<strong>/).slice(1);

const decode = (text) =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&aacute;/g, 'á')
    .replace(/&eacute;/g, 'é')
    .replace(/&iacute;/g, 'í')
    .replace(/&oacute;/g, 'ó')
    .replace(/&uacute;/g, 'ú')
    .replace(/&ntilde;/g, 'ñ');

const clean = (text) =>
  decode(text.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

for (const entry of entries) {
  const head = /^([^<]+)<\/strong>\s*-\s*([^<\n]+)/.exec(entry);
  if (head === null) continue;

  const version = head[1].trim();
  if (version !== wanted) continue;

  const date = clean(head[2]);
  // The nested bullets: everything from the first opening `<ul>` to the last
  // closing one, split per `<li>`.
  const listStart = entry.indexOf('<ul>');
  const listEnd = entry.lastIndexOf('</ul>');
  const list = listStart === -1 || listEnd === -1 ? '' : entry.slice(listStart + 4, listEnd);
  const bullets = list
    .split('<li>')
    .slice(1)
    .map((item) => clean(item.split('</li>')[0] ?? ''))
    .filter((item) => item !== '');

  if (bullets.length === 0) {
    console.error(`changelog-notes: the entry for ${wanted} has no bullets`);
    process.exit(1);
  }

  console.log(`## ${version} — ${date}`);
  console.log('');
  for (const bullet of bullets) console.log(`- ${bullet}`);
  process.exit(0);
}

console.error(
  `changelog-notes: no ${wanted} entry in ${CHANGELOG}. ` +
    'Add it next to the version in packages/frontend/src/vue/views/AboutView.vue.',
);
process.exit(1);
