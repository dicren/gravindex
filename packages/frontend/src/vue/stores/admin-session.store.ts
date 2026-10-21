import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { loginUseCase, logoutUseCase, restoreSessionUseCase } from '#/config/auth.config';
import { AdminSessionExpiredError } from '#/domain/auth/admin-session-expired.error';
import type { AdminCredentials } from '#/domain/auth/admin-session.entity';

/**
 * Whether this browser is logged in as an admin — client state with no server
 * behind it, so a **plain Pinia store**, next to `notifications` and
 * `playback`, and never a Pinia Colada query. There is nothing to cache,
 * deduplicate or revalidate here: one boolean, decided once per page load.
 *
 * ⚠️ **The token is not in this store, and must not be.** It lives behind
 * `AdminTokenStore` in `core/` and is read by the adapters that attach it to a
 * request; what is held here is the *fact* of a session and the name to greet.
 * Keeping the credential out of a reactive store means it cannot end up in
 * devtools state, in an SSR payload, or in a component that only wanted the
 * username.
 *
 * ⚠️ **Nothing here ever touches the anonymous voter token.** That one is an
 * unauthenticated deduplication hint in `localStorage`, is spoofable, and no
 * admin route trusts it (root `CLAUDE.md`, "Identity"). Two identities, two
 * storages, no shared code path.
 */

/**
 * Four states, and the fourth is the one that is easy to omit.
 *
 * - `unknown` — nothing has been checked yet. The guard waits.
 * - `anonymous` — no token, or the server refused the one we had.
 * - `authenticated` — the server confirmed the token this page load.
 * - `unverified` — ⚠️ a token is held but the probe never got an answer. The
 *   admin is let through: the credential was not rejected, the network failed,
 *   and logging someone out because their wifi blinked is a bug they experience
 *   as randomness. The screens they reach will show their own connection error,
 *   truthfully.
 */
export type AdminSessionStatus = 'unknown' | 'anonymous' | 'authenticated' | 'unverified';

export const useAdminSessionStore = defineStore('admin-session', () => {
  const status = ref<AdminSessionStatus>('unknown');
  const username = ref<string | null>(null);

  /**
   * ⚠️ Held so that N navigations in one page load make ONE `GET /admin/me`.
   * The router guard awaits this on every admin route, and without the memo a
   * click from the list to a clip would probe again for an answer already on
   * hand. Cleared on every terminal state so a later logout/login re-probes.
   */
  let restoring: Promise<void> | null = null;

  /** Confirmed this page load. */
  const isAuthenticated = computed(() => status.value === 'authenticated');

  /**
   * There is a credential worth trying — confirmed, or merely uncheckable.
   * ⚠️ This is what the guard admits on, not `isAuthenticated`: see `unverified`.
   */
  const hasSession = computed(
    () => status.value === 'authenticated' || status.value === 'unverified',
  );

  /** The server said no, or there was never a token. What sends you to login. */
  const isSignedOut = computed(() => status.value === 'anonymous');

  async function restore(): Promise<void> {
    const outcome = await restoreSessionUseCase.execute();
    status.value = outcome.status;
    username.value = outcome.status === 'authenticated' ? outcome.identity.username : null;
  }

  /**
   * Settle `status` if it has not been settled yet. Idempotent, and safe to
   * await from a navigation guard on every hop.
   */
  async function ensureRestored(): Promise<void> {
    if (status.value !== 'unknown') return;
    restoring ??= restore().finally(() => {
      restoring = null;
    });
    await restoring;
  }

  /**
   * Log in. Rejects with the domain error so the form can show it — ⚠️ and the
   * form shows ONE message for every refusal, because the endpoint answers an
   * unknown user and a wrong password identically, on purpose.
   */
  async function login(credentials: AdminCredentials): Promise<void> {
    const session = await loginUseCase.execute(credentials);
    status.value = 'authenticated';
    username.value = session.username;
  }

  /** Drop the credential. Local only — there is no logout endpoint to fail. */
  function logout(): void {
    logoutUseCase.execute();
    status.value = 'anonymous';
    username.value = null;
    restoring = null;
  }

  /**
   * What every admin screen calls when a request fails: if the server refused
   * the credential, the session is over and this ends it locally too.
   *
   * ⚠️ **Branching on the error CLASS, not on a status code.** A 401 and the
   * validation pipe's 400 are both `REQUEST_REJECTED`; `AdminSessionExpiredError`
   * is what tells them apart without a view ever seeing a number
   * (`core/domain/errors`). Anything else is returned untouched for the caller
   * to display.
   *
   * ⚠️ It does not navigate. `AdminLayout` watches `isSignedOut` and does that
   * in one place, so a store cannot be the thing that moves the address bar.
   *
   * @returns `true` when the session ended, i.e. the caller's own error message
   *          is now beside the point.
   */
  function noteFailure(error: unknown): boolean {
    if (!(error instanceof AdminSessionExpiredError)) return false;
    logout();
    return true;
  }

  return {
    status,
    username,
    isAuthenticated,
    hasSession,
    isSignedOut,
    ensureRestored,
    login,
    logout,
    noteFailure,
  };
});
