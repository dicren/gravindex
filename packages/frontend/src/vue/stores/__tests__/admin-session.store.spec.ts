import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia } from 'pinia';
import { AdminSessionExpiredError } from '#/domain/auth/admin-session-expired.error';
import { NetworkError, RequestRejectedError } from '#/domain/errors';
import { useAdminSessionStore } from '@/stores/admin-session.store';
import { freshPinia } from '@/components/__tests__/mount-with-vuetify';

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  logout: vi.fn(),
  restore: vi.fn(),
}));

vi.mock('#/config/auth.config', () => ({
  loginUseCase: { execute: mocks.login },
  logoutUseCase: { execute: mocks.logout },
  restoreSessionUseCase: { execute: mocks.restore },
}));

beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(freshPinia());
  mocks.restore.mockResolvedValue({ status: 'anonymous' });
});

describe('restoring a session on page load', () => {
  it('probes ONCE however many navigations ask', async () => {
    mocks.restore.mockResolvedValue({
      status: 'authenticated',
      identity: { id: 1, username: 'moderador' },
    });
    const session = useAdminSessionStore();

    await Promise.all([session.ensureRestored(), session.ensureRestored()]);
    await session.ensureRestored();

    // The guard awaits this on every hop into `/admin`; a probe per navigation
    // would be a request per click for an answer already on hand.
    expect(mocks.restore).toHaveBeenCalledTimes(1);
    expect(session.isAuthenticated).toBe(true);
    expect(session.username).toBe('moderador');
  });

  it('lets an UNVERIFIED token through — a network blip is not a logout', async () => {
    mocks.restore.mockResolvedValue({ status: 'unverified' });
    const session = useAdminSessionStore();

    await session.ensureRestored();

    expect(session.isAuthenticated).toBe(false);
    // ⚠️ What the guard admits on. The credential was not refused, the probe
    // simply never got an answer.
    expect(session.hasSession).toBe(true);
    expect(session.isSignedOut).toBe(false);
  });

  it('is signed out when there is no token', async () => {
    const session = useAdminSessionStore();
    await session.ensureRestored();

    expect(session.hasSession).toBe(false);
    expect(session.isSignedOut).toBe(true);
  });
});

describe('logging in and out', () => {
  it('remembers who logged in', async () => {
    mocks.login.mockResolvedValue({ token: 'jwt-for-tests', username: 'moderador' });
    const session = useAdminSessionStore();

    await session.login({ username: 'moderador', password: 'contraseña-de-prueba' });

    expect(session.isAuthenticated).toBe(true);
    expect(session.username).toBe('moderador');
  });

  it('lets a refusal through untouched, and stays signed out', async () => {
    mocks.login.mockRejectedValue(new RequestRejectedError('Invalid username or password'));
    const session = useAdminSessionStore();

    await expect(session.login({ username: 'quien', password: 'no' })).rejects.toBeInstanceOf(
      RequestRejectedError,
    );
    expect(session.isAuthenticated).toBe(false);
  });

  it('drops the credential on logout', async () => {
    mocks.login.mockResolvedValue({ token: 'jwt-for-tests', username: 'moderador' });
    const session = useAdminSessionStore();
    await session.login({ username: 'moderador', password: 'x' });

    session.logout();

    expect(mocks.logout).toHaveBeenCalledTimes(1);
    expect(session.isSignedOut).toBe(true);
    expect(session.username).toBeNull();
  });
});

describe('a request that fails mid-session', () => {
  it('ends the session when the server refused the credential', async () => {
    mocks.login.mockResolvedValue({ token: 'jwt-for-tests', username: 'moderador' });
    const session = useAdminSessionStore();
    await session.login({ username: 'moderador', password: 'x' });

    expect(session.noteFailure(new AdminSessionExpiredError())).toBe(true);
    expect(session.isSignedOut).toBe(true);
    expect(mocks.logout).toHaveBeenCalledTimes(1);
  });

  it('leaves the session alone for anything else — including another 4xx', async () => {
    mocks.login.mockResolvedValue({ token: 'jwt-for-tests', username: 'moderador' });
    const session = useAdminSessionStore();
    await session.login({ username: 'moderador', password: 'x' });

    // ⚠️ Both of these are `REQUEST_REJECTED`. Telling them apart by CLASS
    // rather than by status is the whole reason `AdminSessionExpiredError`
    // exists: a validation 400 must not log anybody out.
    expect(session.noteFailure(new RequestRejectedError('title is too long'))).toBe(false);
    expect(session.noteFailure(new NetworkError('offline'))).toBe(false);
    expect(session.isAuthenticated).toBe(true);
    expect(mocks.logout).not.toHaveBeenCalled();
  });
});
