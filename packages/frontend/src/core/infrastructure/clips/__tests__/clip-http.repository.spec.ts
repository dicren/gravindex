import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NetworkError,
  NotFoundError,
  RequestAbortedError,
  RequestRejectedError,
  UnexpectedResponseError,
  ValidationError,
} from '#/domain/errors';
import type { VoterTokenProvider } from '#/domain/identity/voter-token.provider';
import { ClipHttpRepository } from '../clip-http.repository';

/**
 * No network and no server: the global `fetch` is stubbed and the assertions
 * are about the request the generated client ends up making — its URL, its
 * query string, its headers and its body.
 *
 * That is the proof behind "no endpoint path is written by hand": `/api/clips`
 * appears nowhere in this feature's source, only in `packages/backend/openapi.json`
 * and the code generated from it.
 */
const realFetch = globalThis.fetch;
const TOKEN = '3f1c2b8a-9d4e-4a6b-8c1d-2e5f7a9b0c3d';

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/**
 * ⚠️ Every request is CLONED as it goes past. `fetch` marks a request's body
 * as read, so inspecting `mock.calls` afterwards can see the headers and the
 * URL but never the body — the clone is what lets a test assert what was
 * actually posted.
 */
const sentRequests: Request[] = [];

function stubFetch(...responses: Response[]) {
  sentRequests.length = 0;
  const fetchStub = vi.fn<typeof fetch>().mockImplementation((input) => {
    sentRequests.push((input as Request).clone());
    return Promise.resolve(
      responses[sentRequests.length - 1] ?? new Response(null, { status: 204 }),
    );
  });
  globalThis.fetch = fetchStub;
  return fetchStub;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function tokenProvider(token = TOKEN): VoterTokenProvider {
  return { getToken: vi.fn<VoterTokenProvider['getToken']>().mockReturnValue(token) };
}

function repository(provider: VoterTokenProvider = tokenProvider()) {
  return new ClipHttpRepository(provider);
}

function requestOf(fetchStub: ReturnType<typeof stubFetch>, call = 0): Request {
  expect(fetchStub).toHaveBeenCalled();
  const request = sentRequests[call];
  expect(request).toBeInstanceOf(Request);
  return request as Request;
}

const EPISODE_DTO = {
  id: 63,
  title: 'Episodio 86 (Spanish Zombies)',
  cover: 'https://example.invalid/cover.jpg',
  file: 'https://example.invalid/episode.mp3',
  originalUrl: 'https://example.invalid/episodio-86',
  date: '2013-05-02T00:00:00.000Z',
};

const CLIP_DTO = {
  id: 178,
  title: 'La canción del zombi',
  start: 792,
  end: 870,
  episode: EPISODE_DTO,
  tags: [
    { clipId: 178, tag: 'Absurdo' },
    { clipId: 178, tag: 'Anécdotas' },
  ],
  // ⚠️ Required — see `findById` below.
  up: 12,
};

describe('ClipHttpRepository.list', () => {
  it('sends every filter, with repeatable tags as `tags=a&tags=b`', async () => {
    const fetchStub = stubFetch(jsonResponse({ total: 0, results: [] }));

    await repository().list({
      page: 2,
      limit: 12,
      order: 'episode.date',
      search: 'canción',
      tags: ['Absurdo', 'Anécdotas'],
    });

    const url = new URL(requestOf(fetchStub).url);
    expect(url.pathname).toBe('/api/clips');
    // ⚠️ The exact wire form the backend's `ClipsQueryDto` reads: one repeated
    // `tags` key (OpenAPI `style: form`, `explode: true`), NOT `tags[]=` and not
    // a comma-joined list. Previously shared links carry `tags[]=`, which the
    // backend still accepts for compatibility, but this client emits the canonical shape.
    expect(url.search).toBe(
      '?page=2&limit=12&order=episode.date&search=canci%C3%B3n&tags=Absurdo&tags=An%C3%A9cdotas',
    );
    expect(url.searchParams.getAll('tags')).toEqual(['Absurdo', 'Anécdotas']);
  });

  it('omits absent filters instead of sending them as "undefined"', async () => {
    const fetchStub = stubFetch(jsonResponse({ total: 0, results: [] }));

    await repository().list({ page: 1 });

    const url = new URL(requestOf(fetchStub).url);
    expect(url.search).toBe('?page=1');
  });

  it('maps a row to a domain clip: tags flattened, date parsed, counts kept', async () => {
    stubFetch(jsonResponse({ total: 42, results: [{ ...CLIP_DTO, up: 15, points: 15 }] }));

    const page = await repository().list({});

    expect(page.total).toBe(42);
    expect(page.results).toHaveLength(1);
    const clip = page.results[0]!;
    expect(clip.tags).toEqual(['Absurdo', 'Anécdotas']);
    expect(clip.episode.date).toBeInstanceOf(Date);
    expect(clip.episode.date.toISOString()).toBe('2013-05-02T00:00:00.000Z');
    // ⚠️ `points` equals `up`: there is nothing for the sort key to subtract.
    // It survives as its own field only because `order=points` is in shared
    // links.
    expect({ up: clip.up, points: clip.points }).toEqual({ up: 15, points: 15 });
    expect(clip).not.toHaveProperty('down');
  });

  it('rejects a list row that lost its vote counts', async () => {
    // The aggregates are the whole reason `GET /clips` differs from
    // `GET /clips/:id`; a row without them is a contract break, not a default.
    stubFetch(jsonResponse({ total: 1, results: [CLIP_DTO] }));

    await expect(repository().list({})).rejects.toBeInstanceOf(UnexpectedResponseError);
  });

  // ── Cancellation ──────────────────────────────────────────────────────────
  // ⚠️ This is the hop that was missing. Everything above it in the chain — the
  // Colada signal, the query function, the use case — can be perfectly wired and
  // the request still runs to completion if the adapter does not put the signal
  // on the call. So the assertion is deliberately about the `Request` object
  // that reaches `fetch`, not about anything this class returns.

  it('⚠️ puts the caller’s AbortSignal on the request handed to fetch', async () => {
    const fetchStub = stubFetch(jsonResponse({ total: 0, results: [] }));
    const controller = new AbortController();

    await repository().list({ search: 'zombi' }, controller.signal);

    // `clone()` (see `stubFetch`) does not carry the signal, so this reads the
    // live argument rather than the recorded copy.
    const sent = fetchStub.mock.calls[0]?.[0] as Request;
    expect(sent.signal.aborted).toBe(false);
    controller.abort();
    expect(sent.signal.aborted).toBe(true);
  });

  it('⚠️ reports a cancelled request as RequestAbortedError, never as a network failure', async () => {
    // The distinction the UI depends on: a withdrawn request must not read as
    // "no se ha podido conectar con el servidor".
    // A server that never answers, and a transport that behaves like the real
    // one: it rejects with the signal's `reason`. ⚠️ The already-aborted branch
    // matters — `ky` can re-issue a GET, and a listener added to a signal that
    // has already fired would never run, hanging the test instead of failing it.
    globalThis.fetch = vi.fn<typeof fetch>().mockImplementation((input) => {
      const { signal } = input as Request;
      if (signal.aborted) return Promise.reject(signal.reason as Error);
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(signal.reason as Error);
        });
      });
    });
    const controller = new AbortController();

    const pending = repository().list({ search: 'zombi' }, controller.signal);
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(RequestAbortedError);
    await expect(pending).rejects.not.toBeInstanceOf(NetworkError);
  });

  it('leaves an ordinary failure alone when the signal was never aborted', async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(repository().list({}, new AbortController().signal)).rejects.toBeInstanceOf(
      NetworkError,
    );
  });
});

describe('ClipHttpRepository.findById', () => {
  // ⚠️ The permalink and the global player both draw `up` for a clip opened by
  // URL, so the endpoint must send it.
  it('returns a clip carrying `up`, and still no `points`', async () => {
    const fetchStub = stubFetch(jsonResponse(CLIP_DTO));

    const clip = await repository().findById(178);

    expect(new URL(requestOf(fetchStub).url).pathname).toBe('/api/clips/178');
    expect(clip.id).toBe(178);
    expect(clip.tags).toEqual(['Absurdo', 'Anécdotas']);
    expect(clip.up).toBe(12);
    // Both absent, for two different reasons: `down` because every vote is
    // positive, `points` because it would be a second name for `up`.
    expect(clip).not.toHaveProperty('down');
    expect(clip).not.toHaveProperty('points');
    // @ts-expect-error `Clip` deliberately has no `points`.
    const _points: number = clip.points;
  });

  // The narrow schema earning its place: `up` is REQUIRED, so a backend that
  // omits it fails here rather than rendering `undefined` as a zero.
  it('rejects a permalink payload with no `up`', async () => {
    const { up: _dropped, ...withoutUp } = CLIP_DTO;
    stubFetch(jsonResponse(withoutUp));

    await expect(repository().findById(178)).rejects.toBeInstanceOf(UnexpectedResponseError);
  });

  it('turns a 404 into a NotFoundError — a deleted clip id is still a live link', async () => {
    stubFetch(jsonResponse({ message: 'nope' }, 404));

    await expect(repository().findById(4)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('turns a payload that breaks the contract into an UnexpectedResponseError', async () => {
    stubFetch(jsonResponse({ ...CLIP_DTO, episode: { ...EPISODE_DTO, date: 'never' } }));

    await expect(repository().findById(178)).rejects.toBeInstanceOf(UnexpectedResponseError);
  });
});

describe('ClipHttpRepository.listRelated', () => {
  it('requests the related endpoint and maps a bare array of list rows', async () => {
    const fetchStub = stubFetch(jsonResponse([{ ...CLIP_DTO, id: 43, up: 8, points: 8 }]));

    const related = await repository().listRelated(178);

    expect(new URL(requestOf(fetchStub).url).pathname).toBe('/api/clips/178/related');
    expect(related).toHaveLength(1);
    expect(related[0]?.id).toBe(43);
    expect(related[0]?.up).toBe(8);
    expect(related[0]?.tags).toEqual(['Absurdo', 'Anécdotas']);
  });

  // ⚠️ No envelope: there is no pagination on six rows, and the endpoint says so
  // by answering an array.
  it('accepts an empty array for a clip with no tags', async () => {
    stubFetch(jsonResponse([]));

    await expect(repository().listRelated(178)).resolves.toEqual([]);
  });

  it('carries the abort signal, like every other read', async () => {
    const controller = new AbortController();
    const fetchStub = stubFetch(jsonResponse([]));

    await repository().listRelated(178, controller.signal);

    expect(requestOf(fetchStub).signal).toBeDefined();
  });
});

describe('ClipHttpRepository.create', () => {
  it('posts the editor draft and carries the voter token as a trail', async () => {
    const fetchStub = stubFetch(jsonResponse(CLIP_DTO, 201));

    await repository().create({
      episodeId: 63,
      title: 'La canción del zombi',
      start: 792,
      end: 870,
      tags: ['Absurdo'],
    });

    const request = requestOf(fetchStub);
    expect(new URL(request.url).pathname).toBe('/api/clips');
    expect(request.method).toBe('POST');
    expect(request.headers.get('x-voter-token')).toBe(TOKEN);
    // `episodeId` in the domain, `episode` on the wire.
    await expect(request.json()).resolves.toEqual({
      title: 'La canción del zombi',
      start: 792,
      end: 870,
      tags: ['Absurdo'],
      episode: 63,
    });
  });

  it('omits the header entirely when there is no token, rather than sending an empty one', async () => {
    const fetchStub = stubFetch(jsonResponse(CLIP_DTO, 201));

    await repository(tokenProvider('')).create({
      episodeId: 63,
      title: 'x',
      start: 1,
      end: 2,
      tags: [],
    });

    expect(requestOf(fetchStub).headers.has('x-voter-token')).toBe(false);
  });

  it('⚠️ hands the ValidationPipe 400 to the editor as a refusal with its message', async () => {
    // The case that made this taxonomy necessary: the backend now validates
    // every request, so a title the API refuses is an EVERYDAY answer. Reporting
    // it as "the server could not be reached" was both false and useless.
    stubFetch(
      jsonResponse(
        {
          statusCode: 400,
          message: ['title must be shorter than or equal to 255 characters'],
          error: 'Bad Request',
        },
        400,
      ),
    );

    const failure = await repository()
      .create({ episodeId: 63, title: 'x'.repeat(300), start: 1, end: 2, tags: [] })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RequestRejectedError);
    expect(failure).not.toBeInstanceOf(NetworkError);
    expect((failure as RequestRejectedError).message).toBe(
      'title must be shorter than or equal to 255 characters',
    );
  });

  it('still reports a broken server as a network failure', async () => {
    stubFetch(jsonResponse({ statusCode: 500, message: 'Internal server error' }, 500));

    await expect(
      repository().create({ episodeId: 63, title: 'x', start: 1, end: 2, tags: [] }),
    ).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('ClipHttpRepository.registerPlay', () => {
  it('posts to the play counter and sends NO identity at all', async () => {
    const fetchStub = stubFetch(jsonResponse({ id: 3814 }, 201));

    await expect(repository().registerPlay(178)).resolves.toBeUndefined();

    const request = requestOf(fetchStub);
    expect(new URL(request.url).pathname).toBe('/api/clips/178/play');
    expect(request.method).toBe('POST');
    // ⚠️ The one write that stores nothing about who made it — not even the
    // anonymous token. Sending it would quietly turn a counter into an identity
    // trail.
    expect(request.headers.has('x-voter-token')).toBe(false);
  });
});

describe('ClipHttpRepository.vote', () => {
  it('sends the token and reports what the server stored', async () => {
    const fetchStub = stubFetch(jsonResponse({ add: 1, delete: 0, error: null }, 201));

    await expect(repository().vote(178, 1)).resolves.toEqual({
      status: 'recorded',
      added: 1,
      removed: 0,
    });

    const request = requestOf(fetchStub);
    expect(new URL(request.url).pathname).toBe('/api/clips/178/vote/1');
    expect(request.headers.get('x-voter-token')).toBe(TOKEN);
  });

  // ⚠️ **There is no "changing your mind"** — there is nothing to change to and
  // `-1` is a 400. What this pins is that `delete` is READ and discarded: the
  // server sends the field, always `0`, and the domain says `removed: 0` rather
  // than pretending the number could be anything else.
  it('reports a recorded vote as an addition and nothing removed', async () => {
    stubFetch(jsonResponse({ add: 1, delete: 0, error: null }, 201));

    await expect(repository().vote(178, 1)).resolves.toEqual({
      status: 'recorded',
      added: 1,
      removed: 0,
    });
  });

  it('⚠️ treats the 201-with-an-error-string as an outcome, not a failure', async () => {
    // The awkward one: a repeated vote is NOT an HTTP error. It must neither
    // reject nor look like a successful vote.
    stubFetch(jsonResponse({ add: 0, delete: 0, error: 'you have already voted' }, 201));

    await expect(repository().vote(178, 1)).resolves.toEqual({ status: 'already-voted' });
  });

  it('refuses to vote without a token instead of earning a 400', async () => {
    const fetchStub = stubFetch(jsonResponse({ add: 1, delete: 0, error: null }, 201));

    await expect(repository(tokenProvider('')).vote(178, 1)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe('ClipHttpRepository.addTag', () => {
  it('puts the tag in the path, url-encoded, and keeps it exactly as typed', async () => {
    const fetchStub = stubFetch(jsonResponse({ clipId: 178, tag: 'Después/antes' }, 201));

    await expect(repository().addTag(178, 'Después/antes')).resolves.toEqual({
      status: 'added',
      tag: 'Después/antes',
    });

    const request = requestOf(fetchStub);
    // ⚠️ The slash matters: unencoded it would be a different route.
    expect(new URL(request.url).pathname).toBe('/api/clips/178/tag/Despu%C3%A9s%2Fantes');
    expect(request.headers.get('x-voter-token')).toBe(TOKEN);
  });

  it('⚠️ maps the 409 to an ordinary outcome, not to an error', async () => {
    stubFetch(jsonResponse({ message: 'Tag repeated' }, 409));

    await expect(repository().addTag(178, 'Absurdo')).resolves.toEqual({
      status: 'already-present',
      tag: 'Absurdo',
    });
  });

  it('still turns a 404 into a NotFoundError', async () => {
    stubFetch(jsonResponse({ message: 'nope' }, 404));

    await expect(repository().addTag(4, 'Absurdo')).rejects.toBeInstanceOf(NotFoundError);
  });
});
