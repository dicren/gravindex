import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NetworkError,
  NotFoundError,
  RequestRejectedError,
  UnexpectedResponseError,
} from '#/domain/errors';
import { EpisodeHttpRepository } from '../episode-http.repository';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function stubFetch(response: Response) {
  const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(response);
  globalThis.fetch = fetchStub;
  return fetchStub;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function urlOf(fetchStub: ReturnType<typeof stubFetch>): URL {
  const request = fetchStub.mock.calls[0]?.[0];
  expect(request).toBeInstanceOf(Request);
  return new URL((request as Request).url);
}

const EPISODE_DTO = {
  id: 63,
  title: 'Episodio 86 (Spanish Zombies)',
  cover: 'https://example.invalid/cover.jpg',
  file: 'https://example.invalid/episode.mp3',
  originalUrl: 'https://example.invalid/episodio-86',
  date: '2013-05-02T00:00:00.000Z',
  clipCount: 7,
};

describe('EpisodeHttpRepository.list', () => {
  it('sends page, limit and the title-only search', async () => {
    const fetchStub = stubFetch(jsonResponse({ total: 395, results: [EPISODE_DTO] }));

    const page = await new EpisodeHttpRepository().list({ page: 3, limit: 20, search: 'zombis' });

    const url = urlOf(fetchStub);
    expect(url.pathname).toBe('/api/episodes');
    expect(url.search).toBe('?page=3&limit=20&search=zombis');
    expect(page.total).toBe(395);
    expect(page.results[0]?.date).toBeInstanceOf(Date);
    // ⚠️ A row carries `clipCount`, not clips: the episode list prints
    // `7 cortes` on every row and filters on it.
    expect(page.results[0]?.clipCount).toBe(7);
  });

  // The `Solo con cortes · 61` toggle. ⚠️ Sent only when TRUE: `false` and
  // absent mean the same thing, so the default stays out of the URL.
  it('sends withClips only when it is on', async () => {
    const fetchStub = stubFetch(jsonResponse({ total: 61, results: [] }));

    await new EpisodeHttpRepository().list({ withClips: true });
    expect(urlOf(fetchStub).search).toBe('?withClips=true');
  });

  it('omits withClips when it is off', async () => {
    const fetchStub = stubFetch(jsonResponse({ total: 395, results: [] }));

    await new EpisodeHttpRepository().list({ withClips: false });
    expect(urlOf(fetchStub).search).toBe('');
  });

  it('omits absent filters', async () => {
    const fetchStub = stubFetch(jsonResponse({ total: 0, results: [] }));

    await new EpisodeHttpRepository().list({});

    expect(urlOf(fetchStub).search).toBe('');
  });

  it('⚠️ reports a rejected page number as a refusal, with the reason', async () => {
    stubFetch(jsonResponse({ statusCode: 400, message: ['page must not be less than 1'] }, 400));

    const failure = await new EpisodeHttpRepository()
      .list({ page: -1 })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RequestRejectedError);
    expect(failure).not.toBeInstanceOf(NetworkError);
    expect((failure as RequestRejectedError).message).toBe('page must not be less than 1');
  });
});

describe('EpisodeHttpRepository.findById', () => {
  it('maps the episode and its clips, which carry up but no points', async () => {
    const fetchStub = stubFetch(
      jsonResponse({
        ...EPISODE_DTO,
        clips: [
          {
            id: 178,
            title: 'La canción del zombi',
            start: 792,
            end: 870,
            tags: [{ clipId: 178, tag: 'Absurdo' }],
            up: 15,
          },
        ],
      }),
    );

    const episode = await new EpisodeHttpRepository().findById(63);

    expect(urlOf(fetchStub).pathname).toBe('/api/episodes/63');
    expect(episode.clips).toHaveLength(1);
    const clip = episode.clips[0]!;
    expect(clip.tags).toEqual(['Absurdo']);
    expect(clip.up).toBe(15);
    // ⚠️ This endpoint sends no `points` and no episode inside each clip, and no
    // `down` anywhere — every vote is positive. The entity says so, and so does
    // the payload it maps.
    expect(clip).not.toHaveProperty('points');
    expect(clip).not.toHaveProperty('down');
    expect(clip).not.toHaveProperty('episode');
    // @ts-expect-error `EpisodeClip` has no `points`.
    const _points: number = clip.points;
  });

  it('accepts an episode nobody has clipped', async () => {
    // 334 of the 395 episodes are in exactly this state.
    stubFetch(jsonResponse({ ...EPISODE_DTO, clips: [] }));

    await expect(new EpisodeHttpRepository().findById(63)).resolves.toMatchObject({ clips: [] });
  });

  it('turns a 404 into a NotFoundError', async () => {
    stubFetch(jsonResponse({ message: 'nope' }, 404));

    await expect(new EpisodeHttpRepository().findById(999)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('turns a clip missing its vote counts into an UnexpectedResponseError', async () => {
    stubFetch(
      jsonResponse({
        ...EPISODE_DTO,
        clips: [{ id: 178, title: 'x', start: 1, end: 2, tags: [] }],
      }),
    );

    await expect(new EpisodeHttpRepository().findById(63)).rejects.toBeInstanceOf(
      UnexpectedResponseError,
    );
  });
});
