import type { AdminToken } from '#/domain/auth/admin-session.entity';
import type { AdminTokenStore } from '#/domain/auth/admin-token.store';

/**
 * ⚠️ **`sessionStorage`, not `localStorage`, and that is the deliberate half of
 * this file.**
 *
 * The anonymous voter token lives in `localStorage` because it *must* outlive
 * the tab: its whole job is to remember, months later, that this browser
 * already voted on clip 178. The admin JWT is the opposite — a credential with
 * a 12 h life, used from a machine that may not be the admin's own. Putting it
 * in `sessionStorage` means:
 *
 * - it **survives a reload and a deep link**, so an admin editing clip 182 who
 *   presses F5 is still logged in, which is the failure the brief calls out;
 * - it **dies when the tab closes**, so a forgotten window on a borrowed
 *   machine does not leave a working credential behind for the next person;
 * - it is in **a different Storage object entirely** from the voter token, not
 *   merely a different key in the same map. Two adapters, two storages, no
 *   iteration over one that could ever reach the other.
 *
 * ⚠️ The key is namespaced all the same. `sessionStorage` is one flat map per
 * origin and this app is not the only thing that will ever write to it.
 *
 * ⚠️ **XSS is not what this choice defends against.** Script running on the
 * page can read either storage; `httpOnly` cookies are the only real answer and
 * the backend issues a bearer token, not a cookie. What the choice buys is the
 * shorter *physical* exposure window, which is a real risk for a
 * one-admin-with-a-laptop project and costs nothing.
 */
const STORAGE_KEY = 'gravindex.admin-token';

/** The slice of `Storage` this adapter uses. `window.sessionStorage` satisfies it. */
export interface AdminTokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * `window.sessionStorage`, or `null` when it cannot be used.
 *
 * ⚠️ Reading the property itself can throw — Safari with "block all cookies", a
 * sandboxed iframe — so the access, not just the call, is inside the `try`.
 */
function resolveSessionStorage(): AdminTokenStorage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The `sessionStorage` adapter behind `AdminTokenStore`.
 *
 * When storage is unavailable or refuses to write, the token falls back to
 * memory for the life of the page. ⚠️ Unlike the voter token's fallback this is
 * barely a compromise: an admin who cannot persist anything simply logs in
 * again after a reload, which is an inconvenience rather than a correctness
 * problem — nothing is deduplicated by this value.
 */
export class SessionStorageAdminTokenStore implements AdminTokenStore {
  private readonly resolveStorage: () => AdminTokenStorage | null;

  /** Used only when storage cannot hold the token. */
  private memoryToken: AdminToken | null = null;

  constructor(resolveStorage: () => AdminTokenStorage | null = resolveSessionStorage) {
    this.resolveStorage = resolveStorage;
  }

  read(): AdminToken | null {
    const storage = this.resolveStorage();
    if (storage === null) return this.memoryToken;

    try {
      // ⚠️ An empty string is not a token: it would be sent as `Bearer `,
      // refused by every route, and read one screen later as "your session
      // expired". Treat it as absent, which it is.
      return storage.getItem(STORAGE_KEY) || this.memoryToken;
    } catch {
      return this.memoryToken;
    }
  }

  write(token: AdminToken): void {
    // Held either way: if the write below throws, the page still has to work.
    this.memoryToken = token;

    const storage = this.resolveStorage();
    if (storage === null) return;
    try {
      storage.setItem(STORAGE_KEY, token);
    } catch {
      // Private mode, quota, disabled storage. The in-memory copy above is what
      // keeps this tab logged in; a reload asks for the password again.
    }
  }

  clear(): void {
    // ⚠️ Memory first, and unconditionally. A logout that failed to reach
    // storage must still leave this page with no credential in hand — the one
    // outcome that must never be partial.
    this.memoryToken = null;

    const storage = this.resolveStorage();
    if (storage === null) return;
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing further to do: the token is already unreachable from this app.
    }
  }
}
