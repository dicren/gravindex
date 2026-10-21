import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminSessionExpiredError } from '#/domain/auth/admin-session-expired.error';
import type { AdminTokenStore } from '#/domain/auth/admin-token.store';
import { VOTER_TOKEN_HEADER } from '#/domain/identity/voter-token.entity';
import { NetworkError, RequestRejectedError, UnexpectedResponseError } from '#/domain/errors';
import { LocalStorageVoterTokenProvider } from '#/infrastructure/identity/local-storage-voter-token.provider';
import { AuthHttpRepository } from '../auth-http.repository';

/**
 * Login and the session probe, against a stubbed `fetch` — no network, no
 * server. The URLs asserted below appear nowhere in this package's source:
 * they come from `packages/backend/openapi.json` through the generated client,
 * which is the proof behind "no endpoint string is written by hand".
 */
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/**
 * ⚠️ The outgoing `Request` is **cloned inside the stub**, not read from
 * `mock.calls` afterwards. By the time an assertion runs the transport has
 * already drained the body, and `request.json()` then throws "Body has already
 * been read" — which looks like a failing adapter and is a failing test.
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

function storeStub(token: string | null): AdminTokenStore {
  return { read: () => token, write: () => {}, clear: () => {} };
}

describe('login', () => {
  it('posts the credentials to the generated operation and returns the session', async () => {
    const fetchStub = stubFetch(
      jsonResponse({ accessToken: 'jwt-for-tests', username: 'moderador' }),
    );

    await expect(
      new AuthHttpRepository(storeStub(null)).login({
        username: 'moderador',
        password: 'contraseña-de-prueba',
      }),
    ).resolves.toEqual({ token: 'jwt-for-tests', username: 'moderador' });

    const request = fetchStub.sent[0] as Request;
    expect(request.url).toContain('/api/auth/login');
    expect(request.method).toBe('POST');
    await expect(request.json()).resolves.toEqual({
      username: 'moderador',
      password: 'contraseña-de-prueba',
    });
  });

  it('turns a refused login into RequestRejectedError, NOT an expired session', async () => {
    stubFetch(jsonResponse({ message: 'Invalid username or password' }, 401));

    const failure = await new AuthHttpRepository(storeStub(null))
      .login({ username: 'quien', password: 'no' })
      .catch((error: unknown) => error);

    // ⚠️ The distinction the login screen depends on. If a bad password came
    // back as `AdminSessionExpiredError`, the layout's watcher would try to
    // navigate the login form to the login form.
    expect(failure).toBeInstanceOf(RequestRejectedError);
    expect(failure).not.toBeInstanceOf(AdminSessionExpiredError);
  });

  it('rejects a login answered with an empty token rather than storing one', async () => {
    stubFetch(jsonResponse({ accessToken: '', username: 'moderador' }));

    await expect(
      new AuthHttpRepository(storeStub(null)).login({ username: 'a', password: 'b' }),
    ).rejects.toBeInstanceOf(UnexpectedResponseError);
  });
});

describe('probe', () => {
  it('sends the JWT as a Bearer credential', async () => {
    const fetchStub = stubFetch(jsonResponse({ id: 1, username: 'moderador' }));

    await expect(new AuthHttpRepository(storeStub('jwt-for-tests')).probe()).resolves.toEqual({
      id: 1,
      username: 'moderador',
    });

    const request = fetchStub.sent[0] as Request;
    expect(request.url).toContain('/api/admin/me');
    expect(request.headers.get('authorization')).toBe('Bearer jwt-for-tests');
  });

  /**
   * ⚠️ **The test this whole slice exists to keep honest.** The anonymous voter
   * token and the admin JWT are two different things, and the failure mode is a
   * client that sends the spoofable one where a credential belongs. The voter
   * token provider is deliberately exercised first, so a real token exists in
   * `localStorage` while the admin call goes out — and it still must not appear.
   */
  it('never sends the anonymous voter token as authentication', async () => {
    const voterToken = new LocalStorageVoterTokenProvider().getToken();
    expect(voterToken).not.toBe('');

    const fetchStub = stubFetch(jsonResponse({ id: 1, username: 'moderador' }));
    await new AuthHttpRepository(storeStub('jwt-for-tests')).probe();

    const request = fetchStub.sent[0] as Request;
    expect(request.headers.get(VOTER_TOKEN_HEADER)).toBeNull();
    expect(request.headers.get('authorization')).toBe('Bearer jwt-for-tests');
    expect(request.headers.get('authorization')).not.toContain(voterToken);
  });

  it('answers "expired" without a request when this browser holds no token', async () => {
    const fetchStub = stubFetch(jsonResponse({ id: 1, username: 'moderador' }));

    await expect(new AuthHttpRepository(storeStub(null)).probe()).rejects.toBeInstanceOf(
      AdminSessionExpiredError,
    );
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('turns a 401 into AdminSessionExpiredError', async () => {
    stubFetch(jsonResponse({ message: 'Unauthorized' }, 401));

    await expect(new AuthHttpRepository(storeStub('stale-jwt')).probe()).rejects.toBeInstanceOf(
      AdminSessionExpiredError,
    );
  });

  it('leaves a transport failure as a NetworkError, so nobody is logged out over it', async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));

    const failure = await new AuthHttpRepository(storeStub('jwt-for-tests'))
      .probe()
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(NetworkError);
    expect(failure).not.toBeInstanceOf(AdminSessionExpiredError);
  });
});
