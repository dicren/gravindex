import { createRouter, createWebHistory } from 'vue-router';
import { registerAdminGuard } from './admin-guard';

/**
 * ⚠️ These URLs are the specification, not a design decision.
 *
 * `indice.gravina82.com` is live, and its links are shared in the wild: the
 * bare `/:id` clip permalink is what the share button copies and what the
 * backend's social-preview meta tags point at, and `/episode/:title` carries
 * the `"<id>-<slug>"` form published since 2019. Both keep
 * working, slug included — only the leading integer is ever parsed.
 *
 * ⚠️ Order matters for reading, not for matching: vue-router ranks static
 * segments above parameters, so `/about` wins over `/:id` regardless. But
 * `/:id` genuinely is catch-all-ish — ANY single unmatched segment lands on the
 * clip view. That is deliberate, not a bug.
 *
 * History mode is on, so the server must rewrite unknown paths to
 * `index.html`. In the target the backend does that itself (root `CLAUDE.md`,
 * "Serving the SPA"); in dev, Vite does it out of the box.
 *
 * ⚠️ A factory, not a bare `createRouter(...)`, for one reason: a test needs to
 * build a SECOND router over the same `window.history` to prove that reloading
 * an error URL lands on the error view. `main.ts` still imports the singleton
 * below and knows nothing about this.
 */
export function createAppRouter() {
  const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    /**
     * ⚠️ **Coming back from a clip must land where you were**, and with infinite
     * scroll that is not automatic: the browser restores a scroll offset into a
     * page that has not rendered its rows yet. It works here because the batches
     * live in the query cache under the FILTER's key
     * (`composables/use-infinite-list.ts`), so the list re-renders at full
     * length in the same tick and this only has to ask for the saved position
     * rather than reconstruct it.
     *
     * ⚠️ `savedPosition` is non-null ONLY for a real back/forward. Every other
     * navigation goes to the top, which is what a new screen wants.
     */
    scrollBehavior: (_to, _from, savedPosition) => savedPosition ?? { top: 0 },
    routes: [
      {
        path: '/',
        name: 'home',
        component: () => import('@/views/HomeView.vue'),
      },
      {
        // ⚠️ **The same view as `episodes`, on purpose.** The calendar is the
        // episode list drawn by date, sharing its rail, its filters and its
        // header; only the middle of the screen changes, and `EpisodesView`
        // branches on `route.name`. It is the pattern `/creator` already uses
        // over `HomeView` — a route that exists so the back button and a direct
        // link work.
        //
        // ⚠️ **The year is a PATH segment, not a query parameter**, and that is
        // forced rather than chosen: `use-list-filters.ts` rebuilds the whole
        // query string from its own filters on every commit, so a `?a=2011`
        // added beside them would be wiped the moment somebody typed in the
        // search box. See `packages/frontend/CLAUDE.md`, "The calendar".
        //
        // ⚠️ Declared BEFORE `/episodes/:page?` for reading, not for matching:
        // vue-router ranks the static `calendario` segment above the parameter
        // either way, and `router.spec.ts` pins that.
        path: '/episodes/calendario/:year?',
        name: 'episodesCalendar',
        component: () => import('@/views/EpisodesView.vue'),
      },
      {
        // ⚠️ `:page?` is vestigial and stays that way: paging really
        // travels in the query string. Do not start reading it.
        path: '/episodes/:page?',
        name: 'episodes',
        component: () => import('@/views/EpisodesView.vue'),
      },
      {
        path: '/episode/:title',
        name: 'episode',
        component: () => import('@/views/EpisodeView.vue'),
      },
      {
        // ⚠️ **It has no view of its own any more.** Choosing an episode stopped
        // being a screen: the header's button opens
        // a floating search overlay over whatever you were looking at, and this
        // route is what makes browser-back close it and a direct link open it.
        // The component renders the library underneath, so entering `/creator`
        // cold opens the overlay over a real screen rather than a blank one.
        path: '/creator',
        name: 'creatorSearch',
        component: () => import('@/views/HomeView.vue'),
      },
      {
        path: '/creator/:title',
        name: 'creator',
        component: () => import('@/views/EditorView.vue'),
      },
      {
        // The queue, reached from the player's pill. `/cola` in Spanish because
        // the URLs a person types should read like the site does.
        path: '/cola',
        name: 'queue',
        component: () => import('@/views/QueueView.vue'),
      },
      {
        path: '/about',
        name: 'about',
        component: () => import('@/views/AboutView.vue'),
      },

      // ── The admin ──────────────────────────────────────────────────────────
      // ⚠️ This is one of three deliberate additions (root `CLAUDE.md`). It exists because today an
      // ugly cut or an abusive tag can only be removed with hand-written SQL
      // against production.
      //
      // ⚠️ `/admin/login` is declared BEFORE the `/admin` layout on purpose —
      // for reading, not for matching. vue-router ranks the static `login`
      // segment above nothing at all, so either order resolves the same; having
      // the public door first is what stops the next reader from assuming the
      // guard covers it.
      {
        path: '/admin/login',
        name: 'adminLogin',
        component: () => import('@/views/admin/AdminLoginView.vue'),
      },
      {
        path: '/admin',
        component: () => import('@/views/admin/AdminLayout.vue'),
        // Merged onto every child by vue-router, which is why no child repeats
        // it and no future child can forget it. See `admin-guard.ts`.
        meta: { requiresAdmin: true },
        children: [
          {
            path: '',
            name: 'adminClips',
            component: () => import('@/views/admin/AdminClipsView.vue'),
          },
          {
            path: 'clips/:id',
            name: 'adminClip',
            component: () => import('@/views/admin/AdminClipView.vue'),
          },
        ],
      },

      // ── The error pages, which are REAL routes now ────────────────────────
      // ⚠️ The URL moves: the error state can be linked and survives a reload,
      // and the back button never walks out of a page whose address did not
      // change. See `error-navigation.ts` for how the app sends itself here.
      //
      // ⚠️ Both paths are unreachable as content: `/:id` only ever resolves a
      // clip id, which is an integer, and `/error/404` is two segments so it
      // cannot collide with a permalink at all.
      {
        path: '/error/404',
        name: 'error404',
        component: () => import('@/views/errors/NotFoundView.vue'),
      },
      {
        path: '/error',
        name: 'errorUnknown',
        component: () => import('@/views/errors/UnknownErrorView.vue'),
      },

      {
        path: '/:id',
        name: 'clip',
        component: () => import('@/views/ClipView.vue'),
      },
      {
        // vue-router 4+ has no bare `*`; this is its spelling. An unknown URL
        // renders the 404 WHERE IT IS — it does not redirect to `/error/404`,
        // because the address the visitor followed is the one worth keeping.
        path: '/:pathMatch(.*)*',
        name: 'E404',
        component: () => import('@/views/errors/NotFoundView.vue'),
      },
    ],
  });

  // ⚠️ Installed by the factory, so a router built in a test is guarded exactly
  // like the one the app runs. A guard registered in `main.ts` instead would be
  // absent from every test that builds its own router — which is every test
  // that could prove the guard works.
  registerAdminGuard(router);

  return router;
}

export const router = createAppRouter();

export default router;
