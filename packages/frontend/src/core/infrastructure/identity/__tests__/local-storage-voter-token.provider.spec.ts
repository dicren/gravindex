import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LocalStorageVoterTokenProvider,
  type VoterTokenStorage,
} from '../local-storage-voter-token.provider';
import { isVoterToken } from '#/domain/identity/voter-token.entity';

// The anonymous voter token (root AGENTS.md, "Identity"). Everything here runs
// with no browser and no server — the whole point of keeping it in `core/`.

const STORAGE_KEY = 'gravindex.voter-token';

/** An isolated `localStorage`, so two providers can be given two empty worlds. */
function createStorage(initial: Record<string, string> = {}): VoterTokenStorage {
  const entries = new Map(Object.entries(initial));
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

describe('LocalStorageVoterTokenProvider', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('mints a well-formed UUID', () => {
    const token = new LocalStorageVoterTokenProvider(() => createStorage()).getToken();

    // Shape matters concretely: the backend answers 400 to anything else
    // (`voter-token.decorator.ts`), and the column is a varchar(36).
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(token).toHaveLength(36);
    expect(isVoterToken(token)).toBe(true);
  });

  it('generates it once and reuses it', () => {
    const storage = createStorage();
    const provider = new LocalStorageVoterTokenProvider(() => storage);

    const first = provider.getToken();
    const second = provider.getToken();

    expect(second).toBe(first);
  });

  it('persists it so the next visit reuses the same one', () => {
    const storage = createStorage();

    const token = new LocalStorageVoterTokenProvider(() => storage).getToken();
    // A reload: same storage, brand-new provider.
    const afterReload = new LocalStorageVoterTokenProvider(() => storage).getToken();

    expect(storage.getItem(STORAGE_KEY)).toBe(token);
    expect(afterReload).toBe(token);
  });

  it('writes it exactly once', () => {
    const storage = createStorage();
    const setItem = vi.spyOn(storage, 'setItem');
    const provider = new LocalStorageVoterTokenProvider(() => storage);

    provider.getToken();
    provider.getToken();
    provider.getToken();

    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it('uses the real localStorage by default', () => {
    const token = new LocalStorageVoterTokenProvider().getToken();

    expect(localStorage.getItem(STORAGE_KEY)).toBe(token);
  });

  // ⚠️ The property the whole design rests on: the token is random and derived
  // from NOTHING. Two providers in identical, empty environments — same
  // browser, same clock, same everything — must still disagree. A token that
  // could be recomputed from the visitor would be personal data again, which is
  // the entire reason the IP column was dropped.
  it('is derived from nothing: identical environments produce different tokens', () => {
    const one = new LocalStorageVoterTokenProvider(() => createStorage()).getToken();
    const other = new LocalStorageVoterTokenProvider(() => createStorage()).getToken();

    expect(other).not.toBe(one);
  });

  it('never repeats itself across many mints', () => {
    const tokens = new Set(
      Array.from({ length: 200 }, () =>
        new LocalStorageVoterTokenProvider(() => createStorage()).getToken(),
      ),
    );

    expect(tokens.size).toBe(200);
  });

  describe('losing it is normal, not an error', () => {
    it('mints a new one after storage is cleared', () => {
      const provider = new LocalStorageVoterTokenProvider();
      const first = provider.getToken();

      localStorage.clear();

      const second = provider.getToken();
      expect(isVoterToken(second)).toBe(true);
      expect(second).not.toBe(first);
      expect(localStorage.getItem(STORAGE_KEY)).toBe(second);
    });

    it('replaces a value that is not a UUID instead of sending it', () => {
      // Hand-edited, or left by some other version of the app. Sending it would
      // earn a 400 on every write.
      const storage = createStorage({ [STORAGE_KEY]: 'not-a-uuid' });

      const token = new LocalStorageVoterTokenProvider(() => storage).getToken();

      expect(isVoterToken(token)).toBe(true);
      expect(storage.getItem(STORAGE_KEY)).toBe(token);
    });

    it('works with no storage at all', () => {
      const provider = new LocalStorageVoterTokenProvider(() => null);

      const token = provider.getToken();

      expect(isVoterToken(token)).toBe(true);
      // Stable within the page, or a single visitor could vote twice from one
      // tab and the backend's (clip, token) uniqueness would never fire.
      expect(provider.getToken()).toBe(token);
    });

    it('survives storage that throws on read (Safari private mode)', () => {
      const storage: VoterTokenStorage = {
        getItem: () => {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        },
        setItem: () => {},
      };

      expect(isVoterToken(new LocalStorageVoterTokenProvider(() => storage).getToken())).toBe(true);
    });

    it('survives storage that throws on write (quota exceeded)', () => {
      const storage: VoterTokenStorage = {
        getItem: () => null,
        setItem: () => {
          throw new DOMException('QuotaExceededError', 'QuotaExceededError');
        },
      };
      const provider = new LocalStorageVoterTokenProvider(() => storage);

      const token = provider.getToken();

      expect(isVoterToken(token)).toBe(true);
      expect(provider.getToken()).toBe(token);
    });

    it('survives the localStorage property itself throwing', () => {
      // Not just `getItem`: reading `window.localStorage` throws outright when
      // the browser blocks storage for the origin (Safari, "block all
      // cookies"), which is why the default resolver wraps the ACCESS.
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('Access denied.', 'SecurityError');
        },
      });

      try {
        const provider = new LocalStorageVoterTokenProvider();

        const token = provider.getToken();

        expect(isVoterToken(token)).toBe(true);
        expect(provider.getToken()).toBe(token);
      } finally {
        if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
      }
    });
  });

  // The v4-by-hand branch, which is what runs when `crypto.randomUUID` is
  // missing — a real case, not a hypothetical: it is restricted to secure
  // contexts, so it is absent over plain http on a LAN address in dev.
  describe('without crypto.randomUUID', () => {
    it('still mints a well-formed, unique, version-4 UUID', () => {
      // Removed outright rather than mocked: the adapter branches on
      // `typeof crypto.randomUUID === 'function'`, which a mock still satisfies.
      const original = crypto.randomUUID;
      Reflect.deleteProperty(crypto, 'randomUUID');

      try {
        const token = new LocalStorageVoterTokenProvider(() => createStorage()).getToken();
        const other = new LocalStorageVoterTokenProvider(() => createStorage()).getToken();

        expect(isVoterToken(token)).toBe(true);
        expect(token[14]).toBe('4');
        expect(['8', '9', 'a', 'b']).toContain(token[19]);
        expect(other).not.toBe(token);
      } finally {
        Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true });
        vi.restoreAllMocks();
      }
    });
  });
});
