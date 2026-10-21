import { describe, expect, it, vi } from 'vitest';
import { AdminSessionExpiredError } from '#/domain/auth/admin-session-expired.error';
import type { AuthRepository } from '#/domain/auth/auth.repository';
import { NetworkError, RequestRejectedError, ValidationError } from '#/domain/errors';
import { LoginUseCase } from '../login.use-case';
import { LogoutUseCase } from '../logout.use-case';
import { RestoreSessionUseCase } from '../restore-session.use-case';
import { tokenStoreStub } from './auth-store.stub';

/**
 * The session half of the admin slice, tested with no browser, no store and no
 * network — which is exactly what the hexagonal split is for.
 *
 * The three cases that matter here are the ones a later change is most likely
 * to break: logging in must *persist* the credential, a refused probe must
 * *erase* it, and a probe that never got an answer must *keep* it.
 */
function authRepositoryStub(overrides: Partial<AuthRepository> = {}): AuthRepository {
  return {
    login: vi.fn().mockResolvedValue({ token: 'jwt-for-tests', username: 'moderador' }),
    probe: vi.fn().mockResolvedValue({ id: 1, username: 'moderador' }),
    ...overrides,
  };
}

describe('LoginUseCase', () => {
  it('stores the token as part of logging in', async () => {
    const store = tokenStoreStub();
    const session = await new LoginUseCase(authRepositoryStub(), store).execute({
      username: 'moderador',
      password: 'contraseña-de-prueba',
    });

    expect(session).toEqual({ token: 'jwt-for-tests', username: 'moderador' });
    // The assertion that matters: a login that returned a token and did not
    // keep it leaves the app authenticated in memory only, and logged out on
    // the next reload.
    expect(store.read()).toBe('jwt-for-tests');
  });

  it('refuses an empty field without reaching the network', async () => {
    const repository = authRepositoryStub();
    const store = tokenStoreStub();

    await expect(
      new LoginUseCase(repository, store).execute({ username: '  ', password: 'x' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(repository.login).not.toHaveBeenCalled();
    expect(store.read()).toBeNull();
  });

  it('leaves no token behind when the server refuses the credentials', async () => {
    const store = tokenStoreStub();
    const repository = authRepositoryStub({
      login: vi.fn().mockRejectedValue(new RequestRejectedError('Invalid username or password')),
    });

    await expect(
      new LoginUseCase(repository, store).execute({ username: 'quien', password: 'no' }),
    ).rejects.toBeInstanceOf(RequestRejectedError);
    expect(store.read()).toBeNull();
  });
});

describe('RestoreSessionUseCase', () => {
  it('answers anonymous with no request when there is no token', async () => {
    const repository = authRepositoryStub();

    await expect(
      new RestoreSessionUseCase(repository, tokenStoreStub()).execute(),
    ).resolves.toEqual({ status: 'anonymous' });
    expect(repository.probe).not.toHaveBeenCalled();
  });

  it('confirms a token the server accepts', async () => {
    await expect(
      new RestoreSessionUseCase(authRepositoryStub(), tokenStoreStub('jwt-for-tests')).execute(),
    ).resolves.toEqual({ status: 'authenticated', identity: { id: 1, username: 'moderador' } });
  });

  it('ERASES a token the server refuses — a 12 h expiry is a normal event', async () => {
    const store = tokenStoreStub('stale-jwt');
    const repository = authRepositoryStub({
      probe: vi.fn().mockRejectedValue(new AdminSessionExpiredError()),
    });

    await expect(new RestoreSessionUseCase(repository, store).execute()).resolves.toEqual({
      status: 'anonymous',
    });
    // Without this, every navigation re-asks a question already answered.
    expect(store.read()).toBeNull();
  });

  it('KEEPS a token it could not check — a network blip is not a logout', async () => {
    const store = tokenStoreStub('jwt-for-tests');
    const repository = authRepositoryStub({
      probe: vi.fn().mockRejectedValue(new NetworkError('offline')),
    });

    await expect(new RestoreSessionUseCase(repository, store).execute()).resolves.toEqual({
      status: 'unverified',
    });
    expect(store.read()).toBe('jwt-for-tests');
  });
});

describe('LogoutUseCase', () => {
  it('forgets the token, with no endpoint to call', () => {
    const store = tokenStoreStub('jwt-for-tests');
    new LogoutUseCase(store).execute();
    expect(store.read()).toBeNull();
  });
});
