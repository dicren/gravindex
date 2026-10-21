import type { RouteLocationNormalized, RouteLocationRaw, Router } from 'vue-router';
import { useAdminSessionStore } from '@/stores/admin-session.store';

/**
 * The gate in front of `/admin`.
 *
 * ⚠️ **A navigation guard, and not a `v-if` inside a layout, precisely so that
 * nothing flashes.** A component that renders and then decides it should not
 * have has already painted: for one frame an unauthenticated visitor sees the
 * moderation screen, and on a slow probe rather longer than a frame. Here the
 * decision happens *before* the route's component is even fetched — the views
 * are lazy imports, so on a rejected visit their chunk is never loaded and
 * their markup never exists.
 *
 * ⚠️ **It `await`s the session probe.** Checking only "is there a token?" would
 * let an expired one through and put the admin screen on screen for as long as
 * `GET /api/admin/me` takes to say no — the flash this guard exists to prevent,
 * just with an extra step. The probe runs once per page load
 * (`ensureRestored` memoizes it), so the wait is paid on the first admin
 * navigation and never again.
 *
 * ⚠️ The gate is not the security boundary and must not be mistaken for one.
 * Every admin route is enforced by the backend's guard; this only decides what
 * to draw. A visitor who edits their way past it reaches screens that 401.
 */

declare module 'vue-router' {
  interface RouteMeta {
    /**
     * Set on the `/admin` parent record; vue-router merges `meta` down the
     * matched chain, so every child inherits it and nobody has to remember.
     */
    requiresAdmin?: boolean;
  }
}

/** Where an unauthenticated visit to `to` is sent. */
export function loginRedirectFor(to: RouteLocationNormalized): RouteLocationRaw {
  return {
    name: 'adminLogin',
    // ⚠️ Carried so that logging in resumes where the visitor was going — the
    // "without losing their place" half of handling a mid-session expiry. It is
    // only ever read back as a route the app itself produced (see
    // `AdminLoginView`, which refuses anything that is not an `/admin` path):
    // an open redirect built out of a query parameter is a classic, and this is
    // where it would start.
    query: { redirect: to.fullPath },
  };
}

/**
 * Decide a single navigation. Exported bare so a test can drive it without a
 * router, and so the wiring below stays one line.
 */
export async function resolveAdminNavigation(
  to: RouteLocationNormalized,
): Promise<RouteLocationRaw | true> {
  const isLogin = to.name === 'adminLogin';
  if (!isLogin && to.meta.requiresAdmin !== true) return true;

  const session = useAdminSessionStore();
  await session.ensureRestored();

  // Already logged in and asking for the login form: there is nothing to do
  // there. Sending them on to the moderation screen is what makes the browser's
  // Back button out of `/admin` behave, instead of bouncing between the two.
  if (isLogin) {
    return session.hasSession ? { name: 'adminClips' } : true;
  }

  // ⚠️ `hasSession`, not `isAuthenticated`: a token the probe could not CHECK
  // (offline, a 5xx) has not been rejected, and turning a network blip into a
  // logout is a bug the admin experiences as randomness. The screens behind
  // this gate show their own connection error, truthfully, and the backend
  // still refuses anything the credential cannot buy.
  return session.hasSession ? true : loginRedirectFor(to);
}

/**
 * Install the gate. Called from `createAppRouter()`, so every router the app
 * builds — including the ones tests build — carries it.
 *
 * ⚠️ The store is resolved INSIDE the callback, never at module scope: this
 * runs while the router is being created, which is before `main.ts` has
 * installed Pinia.
 */
export function registerAdminGuard(router: Router): void {
  router.beforeEach((to) => resolveAdminNavigation(to));
}
