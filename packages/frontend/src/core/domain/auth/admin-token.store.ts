import type { AdminToken } from './admin-session.entity';

/**
 * Where the admin credential is kept between page loads. Implemented by
 * `infrastructure/auth/session-storage-admin-token.store.ts`.
 *
 * ⚠️ **A port, not a convenience.** It is what lets the login use case be
 * tested with `{ read: () => null, write() {}, clear() {} }` and no browser
 * storage — and, more importantly, it is the single place in the application
 * that names where the JWT lives. There is exactly one implementation and
 * exactly one storage key; nothing else in the app reads or writes it, and
 * nothing here ever touches the anonymous voter token's key
 * (`gravindex.voter-token`, in a different Storage object entirely — see
 * `domain/auth/admin-session.entity.ts`).
 *
 * Synchronous, like `VoterTokenProvider` and for the same reason: web storage
 * is synchronous and a promise here would force every caller, including the
 * `auth` callback the generated client invokes per request, to become async
 * for nothing.
 *
 * ⚠️ `read()` returning `null` is an ordinary state, not an error: it is what
 * "nobody is logged in" looks like, and it is also what a second browser, a
 * private window and a closed tab all look like.
 */
export interface AdminTokenStore {
  read(): AdminToken | null;
  write(token: AdminToken): void;
  clear(): void;
}
