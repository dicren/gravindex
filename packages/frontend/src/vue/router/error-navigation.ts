import type { RouteLocationRaw, Router } from 'vue-router';
import { NotFoundError } from '#/domain/errors';
import { router as appRouter } from './index';

/**
 * How a view says "the thing I was asked to show does not exist".
 *
 * A view hands an error over to the router instead of swapping itself for an
 * error component. **The URL moves**, so the error state can be linked, survives
 * a reload, and the back button never points out of an address that did not
 * change. The error page is an ordinary route like any other.
 *
 * ⚠️ `replace`, not `push`, on purpose. The URL that failed is not somewhere the
 * visitor can usefully go back to: with `push`, "back" would land on the broken
 * clip id, fetch it, fail again and bounce forward to the error page — a
 * history trap that is impossible to escape by pressing back. Replacing leaves
 * the previous *working* page as the back target, and `/error/404` itself is
 * still linkable and reloadable, which is the whole point of the change.
 *
 * ⚠️ It does NOT catch anything by itself. Deciding between "navigate away" and
 * "raise a toast and stay" belongs to the caller: a lost network connection
 * while voting must not throw away the page the visitor is on.
 */

/** The route an error maps to. Exported for tests and for a guard that wants to
 *  resolve without navigating. */
export function errorRouteFor(error: unknown): RouteLocationRaw {
  // ⚠️ Branch on the DOMAIN error, never on an HTTP status: views do not know
  // that the transport is HTTP (see `core/domain/errors`). `NotFoundError` is
  // the legitimate answer "this is gone" — a handful of clip ids were deleted
  // by hand years ago and their permalinks are still shared.
  return error instanceof NotFoundError ? { name: 'error404' } : { name: 'errorUnknown' };
}

/**
 * Send the app to the error page that fits `error`.
 *
 * ```ts
 * try {
 *   episode.value = await getEpisodeUseCase.execute(id);
 * } catch (error) {
 *   await goToErrorPage(error);
 * }
 * ```
 */
export async function goToErrorPage(error: unknown, router: Router = appRouter): Promise<void> {
  await router.replace(errorRouteFor(error));
}

/**
 * Send the app to the 404 page with no error in hand — the "this id is not even
 * a number" case, which both `Episode` and `Editor` detect before they ever call
 * the API (`parseInt` → `isNaN`).
 */
export async function goToNotFoundPage(router: Router = appRouter): Promise<void> {
  await router.replace({ name: 'error404' });
}
