import type { VoterTokenProvider } from '#/domain/identity/voter-token.provider';
import { isVoterToken, type VoterToken } from '#/domain/identity/voter-token.entity';

/**
 * Where the token lives. Namespaced because `localStorage` is one flat map per
 * origin, shared with the per-endpoint list `limit` and with whatever the
 * consent banner will keep.
 */
const STORAGE_KEY = 'gravindex.voter-token';

/** The slice of `Storage` this adapter uses. `window.localStorage` satisfies it. */
export interface VoterTokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * A fresh, random token.
 *
 * ⚠️ `crypto.randomUUID()` is the whole implementation on purpose: it is
 * cryptographically random and derived from nothing — no time, no
 * user-agent, no canvas, no hash of anything about the visitor. Any change
 * here that mixes in something "stable" turns this back into personal data.
 *
 * The `getRandomValues` branch is the same guarantee for one real case, not a
 * paranoia fallback: `crypto.randomUUID` is restricted to secure contexts, so
 * it is absent when a developer opens the dev server over `http://` on a LAN
 * address. It builds a v4 UUID by hand from the same CSPRNG.
 */
function createVoterToken(): VoterToken {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // Version 4, variant 10xx — the two fields that are not random by definition.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * `window.localStorage`, or `null` when it cannot be used.
 *
 * ⚠️ Reading the property itself can throw — Safari with "block all cookies",
 * a sandboxed iframe — so the access, not just the call, is inside the `try`.
 */
function resolveLocalStorage(): VoterTokenStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The `localStorage` adapter behind `VoterTokenProvider`.
 *
 * Storage is the source of truth, re-read on every call rather than cached, and
 * that is deliberate: a visitor who clears site data mid-session simply gets a
 * new token on the next write, silently and with no error — which is exactly
 * the contract (`voter-token.entity.ts`, "losing it is normal"). Reading one
 * short string per write costs nothing at this app's traffic.
 *
 * When storage is unavailable or refuses to write (private windows, quota,
 * disabled cookies), the token falls back to memory for the life of the page.
 * ⚠️ It is *not* dropped and re-minted per call: within one page the token
 * still has to be stable, or a single visitor could vote twice on the same clip
 * from the same tab and the backend's `(clip, token)` uniqueness would never
 * fire. Across reloads it does change, and that is accepted.
 */
export class LocalStorageVoterTokenProvider implements VoterTokenProvider {
  private readonly resolveStorage: () => VoterTokenStorage | null;

  /** In-memory token, used only when storage cannot hold one. */
  private memoryToken: VoterToken | null = null;

  constructor(resolveStorage: () => VoterTokenStorage | null = resolveLocalStorage) {
    this.resolveStorage = resolveStorage;
  }

  getToken(): VoterToken {
    const storage = this.resolveStorage();
    if (storage === null) {
      return (this.memoryToken ??= createVoterToken());
    }

    try {
      const stored = storage.getItem(STORAGE_KEY);
      if (isVoterToken(stored)) {
        return stored;
      }
    } catch {
      // Unreadable storage behaves exactly like empty storage: mint one below.
    }

    const token = createVoterToken();
    try {
      storage.setItem(STORAGE_KEY, token);
      return token;
    } catch {
      // Could not persist (private mode, quota). Keep this one in memory so the
      // page at least stays consistent with itself.
      return (this.memoryToken ??= token);
    }
  }
}
