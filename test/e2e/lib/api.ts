// Direct calls to the local backend, for the two things a browser cannot do on
// this suite's behalf: set up a row a test needs to exist, and read back what a
// write actually stored.
//
// ⚠️ `API_URL` is the backend itself, not the dev server's proxy — the meta-tag
// group needs the HTML the backend renders, and the dev server serves the raw
// `index.html` with no injection at all.

import { API_URL } from './constants';

/** ⚠️ A tag arrives as the `(clipId, tag)` pair, not as a bare string — a tag IS
 *  that pair, there is no tag table (root `CLAUDE.md`, "Data model"). */
export interface TagJson {
  clipId: number;
  tag: string;
}

export interface EpisodeClipJson {
  id: number;
  title: string;
  start: number;
  end: number;
  up: number;
  down: number;
  tags: TagJson[];
}

export interface EpisodeJson {
  id: number;
  title: string;
  cover: string;
  file: string;
  clips: EpisodeClipJson[];
}

export interface ClipJson {
  id: number;
  title: string;
  start: number;
  end: number;
  tags: TagJson[];
  episode: { id: number; title: string; cover: string; file: string };
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`);
  if (!response.ok) throw new Error(`GET ${path} answered ${response.status}`);
  return (await response.json()) as T;
}

export function getEpisode(id: number): Promise<EpisodeJson> {
  return getJson<EpisodeJson>(`/api/episodes/${id}`);
}

export interface EpisodeWaveformJson {
  from: number;
  to: number;
  points: number;
  peaks: string;
}

export function getEpisodeWaveform(
  id: number,
  query: { from?: number; to?: number; points?: number } = {},
): Promise<EpisodeWaveformJson> {
  const params = new URLSearchParams();
  if (query.from !== undefined) params.set('from', String(query.from));
  if (query.to !== undefined) params.set('to', String(query.to));
  if (query.points !== undefined) params.set('points', String(query.points));
  const qs = params.toString();
  return getJson<EpisodeWaveformJson>(`/api/episodes/${id}/waveform${qs ? `?${qs}` : ''}`);
}

export function getClip(id: number): Promise<ClipJson> {
  return getJson<ClipJson>(`/api/clips/${id}`);
}

export interface CreateClipInput {
  episode: number;
  title: string;
  start: number;
  end: number;
  tags: string[];
  token: string;
}

/** Creates a clip and returns its id. The row carries `token`, so the teardown
 *  finds it by exactly the value used here. */
export async function createClip(input: CreateClipInput): Promise<number> {
  const response = await fetch(`${API_URL}/api/clips`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-voter-token': input.token },
    body: JSON.stringify({
      episode: input.episode,
      title: input.title,
      start: input.start,
      end: input.end,
      tags: input.tags,
    }),
  });
  if (!response.ok) {
    throw new Error(`POST /api/clips answered ${response.status}: ${await response.text()}`);
  }
  const created = (await response.json()) as { id: number };
  return created.id;
}

/** The server-rendered `index.html` for a path, exactly as a crawler with no
 *  JavaScript receives it. */
export async function fetchRawPage(path: string): Promise<{ status: number; html: string }> {
  const response = await fetch(`${API_URL}${path}`, { headers: { accept: 'text/html' } });
  return { status: response.status, html: await response.text() };
}
