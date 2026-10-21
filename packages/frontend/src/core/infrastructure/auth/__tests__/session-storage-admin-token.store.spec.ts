import { beforeEach, describe, expect, it } from 'vitest';
import { LocalStorageVoterTokenProvider } from '#/infrastructure/identity/local-storage-voter-token.provider';
import {
  SessionStorageAdminTokenStore,
  type AdminTokenStorage,
} from '../session-storage-admin-token.store';

beforeEach(() => {
  globalThis.sessionStorage.clear();
  globalThis.localStorage.clear();
});

describe('SessionStorageAdminTokenStore', () => {
  it('keeps the token across reads, and forgets it on clear', () => {
    const store = new SessionStorageAdminTokenStore();

    expect(store.read()).toBeNull();
    store.write('jwt-for-tests');
    expect(store.read()).toBe('jwt-for-tests');
    store.clear();
    expect(store.read()).toBeNull();
  });

  /**
   * ⚠️ **The separation, asserted rather than merely commented.** The admin JWT
   * and the anonymous voter token are two different things with two different
   * lifetimes, and this test fails the moment one of them starts using the
   * other's storage — which is the change that would make a credential outlive
   * the tab, or make an admin's identity readable by the public voting path.
   */
  it('lives in sessionStorage, in a different Storage object from the voter token', () => {
    new SessionStorageAdminTokenStore().write('jwt-for-tests');
    const voterToken = new LocalStorageVoterTokenProvider().getToken();

    expect(globalThis.sessionStorage.getItem('gravindex.admin-token')).toBe('jwt-for-tests');
    expect(globalThis.localStorage.getItem('gravindex.admin-token')).toBeNull();

    expect(globalThis.localStorage.getItem('gravindex.voter-token')).toBe(voterToken);
    expect(globalThis.sessionStorage.getItem('gravindex.voter-token')).toBeNull();

    // Nothing in `sessionStorage` may be the voter token, and vice versa.
    expect(voterToken).not.toBe('jwt-for-tests');
  });

  it('treats an empty stored value as no token — `Bearer ` is not a credential', () => {
    globalThis.sessionStorage.setItem('gravindex.admin-token', '');
    expect(new SessionStorageAdminTokenStore().read()).toBeNull();
  });

  it('keeps the tab logged in when storage refuses to write', () => {
    const refusing: AdminTokenStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      removeItem: () => {},
    };
    const store = new SessionStorageAdminTokenStore(() => refusing);

    store.write('jwt-for-tests');
    // A private window must not mean "cannot log in at all"; it means "log in
    // again after a reload".
    expect(store.read()).toBe('jwt-for-tests');
    store.clear();
    expect(store.read()).toBeNull();
  });

  it('drops the in-memory copy even when removing from storage throws', () => {
    const hostile: AdminTokenStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new Error('nope');
      },
    };
    const store = new SessionStorageAdminTokenStore(() => hostile);

    store.write('jwt-for-tests');
    store.clear();
    // ⚠️ A logout that leaves a usable credential behind is the one outcome
    // that must never be partial.
    expect(store.read()).toBeNull();
  });

  it('falls back to memory when storage cannot be reached at all', () => {
    const store = new SessionStorageAdminTokenStore(() => null);

    store.write('jwt-for-tests');
    expect(store.read()).toBe('jwt-for-tests');
    store.clear();
    expect(store.read()).toBeNull();
  });
});
