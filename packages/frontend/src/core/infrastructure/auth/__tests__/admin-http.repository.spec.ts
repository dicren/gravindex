import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminSessionExpiredError } from '#/domain/auth/admin-session-expired.error';
import type { AdminTokenStore } from '#/domain/auth/admin-token.store';
import { NotFoundError, RequestRejectedError } from '#/domain/errors';
import { VOTER_TOKEN_HEADER } from '#/domain/identity/voter-token.entity';
import { LocalStorageVoterTokenProvider } from '#/infrastructure/identity/local-storage-voter-token.provider';
import { AdminHttpRepository } from '../admin-http.repository';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/**
 * ⚠️ The outgoing `Request` is **cloned inside the stub**, not read from
 * `mock.calls` afterwards: by assertion time the transport has already drained
 * the body, and `request.json()` then throws "Body has already been read".
 */
function stubFetch(response: Response) {
  const sent: Request[] = [];
  const fetchStub = vi.fn<typeof fetch>().mockImplementation((input) => {
    if (input instanceof Request) sent.push(input.clone());
    return Promise.resolve(response);
  });
  globalThis.fetch = fetchStub;
  return Object.assign(fetchStub, { sent });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function storeStub(token: string | null = 'jwt-for-tests'): AdminTokenStore {
  return { read: () => token, write: () => {}, clear: () => {} };
}

const CLIP_BODY = {
  id: 182,
  title: 'La mulata del clítor...',
  start: 792,
  end: 870,
  episodeId: 63,
  tags: ['Mulata'],
};

describe('reading and editing a clip', () => {
  it('gets one clip, with the JWT and nothing else', async () => {
    const voterToken = new LocalStorageVoterTokenProvider().getToken();
    const fetchStub = stubFetch(jsonResponse(CLIP_BODY));

    await expect(new AdminHttpRepository(storeStub()).getClip(182)).resolves.toEqual({
      id: 182,
      title: 'La mulata del clítor...',
      start: 792,
      end: 870,
      episodeId: 63,
      tags: ['Mulata'],
    });

    const request = fetchStub.sent[0] as Request;
    expect(request.url).toContain('/api/admin/clips/182');
    expect(request.headers.get('authorization')).toBe('Bearer jwt-for-tests');
    // ⚠️ Two identities, and the anonymous one has no business on this call.
    expect(request.headers.get(VOTER_TOKEN_HEADER)).toBeNull();
    expect(voterToken).not.toBe('');
  });

  it('PATCHes only the fields present, omitting the untouched ones entirely', async () => {
    const fetchStub = stubFetch(jsonResponse(CLIP_BODY));

    await new AdminHttpRepository(storeStub()).updateClip(182, { title: 'Arreglado' });

    const request = fetchStub.sent[0] as Request;
    expect(request.method).toBe('PATCH');
    // `start`/`end` are absent, not `null`: the validation pipe refuses a null.
    await expect(request.json()).resolves.toEqual({ title: 'Arreglado' });
  });

  it('surfaces the server’s own explanation on a 400', async () => {
    stubFetch(jsonResponse({ message: ['end must be greater than start'] }, 400));

    const failure = await new AdminHttpRepository(storeStub())
      .updateClip(182, { end: 1 })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RequestRejectedError);
    expect((failure as Error).message).toBe('end must be greater than start');
    // ⚠️ A 400 is a form problem, not a session problem. Confusing the two
    // would throw the admin out of a screen over a typo.
    expect(failure).not.toBeInstanceOf(AdminSessionExpiredError);
  });

  it('DELETEs a clip and expects no body back', async () => {
    const fetchStub = stubFetch(new Response(null, { status: 204 }));

    await expect(new AdminHttpRepository(storeStub()).deleteClip(182)).resolves.toBeUndefined();

    const request = fetchStub.sent[0] as Request;
    expect(request.method).toBe('DELETE');
    expect(request.url).toContain('/api/admin/clips/182');
  });

  it('reports a clip that is already gone as NotFoundError', async () => {
    stubFetch(jsonResponse({ message: 'Clip 999 not found' }, 404));

    await expect(new AdminHttpRepository(storeStub()).deleteClip(999)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('tags never travel in a path segment', () => {
  /**
   * ⚠️ The rule the backend's DTO spells out and this side has to keep: a tag
   * is free text, and one containing a `/` in a path is not a route with a
   * funny parameter — it is a different route, or a 404. The tag below is
   * chosen to fail loudly if that ever regresses.
   */
  const NASTY_TAG = 'rock/roll & ñ?';

  it('sends a removal’s tag as a query parameter', async () => {
    const fetchStub = stubFetch(new Response(null, { status: 204 }));

    await new AdminHttpRepository(storeStub()).removeTag(182, NASTY_TAG);

    const request = fetchStub.sent[0] as Request;
    const url = new URL(request.url);
    expect(request.method).toBe('DELETE');
    expect(url.pathname).toBe('/api/admin/clips/182/tags');
    expect(url.searchParams.get('tag')).toBe(NASTY_TAG);
  });

  it('sends a rename’s tags in the body', async () => {
    const fetchStub = stubFetch(jsonResponse(CLIP_BODY));

    await new AdminHttpRepository(storeStub()).renameTag(182, {
      tag: NASTY_TAG,
      newTag: 'Anécdotas',
    });

    const request = fetchStub.sent[0] as Request;
    expect(new URL(request.url).pathname).toBe('/api/admin/clips/182/tags');
    expect(request.method).toBe('PATCH');
    await expect(request.json()).resolves.toEqual({ tag: NASTY_TAG, newTag: 'Anécdotas' });
  });

  it('reports a 409 rename as a refusal carrying the server’s message', async () => {
    stubFetch(jsonResponse({ message: 'The clip already carries that tag' }, 409));

    const failure = await new AdminHttpRepository(storeStub())
      .renameTag(182, { tag: 'Mulata', newTag: 'Anécdotas' })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RequestRejectedError);
    expect((failure as Error).message).toBe('The clip already carries that tag');
  });
});

describe('the session ending mid-edit', () => {
  it('turns any 401 into AdminSessionExpiredError', async () => {
    stubFetch(jsonResponse({ message: 'Unauthorized' }, 401));

    await expect(new AdminHttpRepository(storeStub()).getClip(182)).rejects.toBeInstanceOf(
      AdminSessionExpiredError,
    );
  });

  it('refuses to make the request at all with no token in this browser', async () => {
    const fetchStub = stubFetch(jsonResponse(CLIP_BODY));

    await expect(new AdminHttpRepository(storeStub(null)).getClip(182)).rejects.toBeInstanceOf(
      AdminSessionExpiredError,
    );
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
