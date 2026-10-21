# syntax=docker/dockerfile:1

# One image, one process, both halves of the site.
#
# The backend serves the API under `/api` AND the built SPA around it, with an
# `index.html` fallback that injects the social-preview meta tags (see
# `packages/backend/src/spa/`). That is a settled decision — there is no reverse
# proxy and no user-agent sniffing anywhere — and it is why the frontend is
# built HERE rather than served from its own container: the two artefacts have
# to share an origin, so they may as well share an image.
#
# It also makes the frontend's default API base URL (empty = same origin)
# exactly right with no build argument at all.
#
# Four stages, so that the final layer holds neither a compiler nor a
# `devDependency`:
#
#   deps       every dependency, for building
#   build      backend `dist/` + SPA `dist/`
#   prod-deps  a second, clean install with `--omit=dev`
#   runtime    prod-deps + the two `dist/` trees, nothing else
#
# Build it with `docker compose build`, or `docker build -t gravindex-api .`.

ARG NODE_IMAGE=node:24-slim

# ──────────────────────────────────────────────────────────────────────────────
# deps — the full dependency tree, cached on the lockfile alone
# ──────────────────────────────────────────────────────────────────────────────
# ⚠️ Only the manifests are copied before `npm ci`, so editing a `.ts` file does
# not re-run the install. In a workspaces monorepo that means the ROOT
# `package.json` (which owns the `workspaces` array) plus one manifest per
# package: `npm ci` refuses to run if a workspace listed there is missing.
FROM ${NODE_IMAGE} AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/backend/package.json packages/backend/package.json
COPY packages/frontend/package.json packages/frontend/package.json

RUN --mount=type=cache,target=/root/.npm npm ci

# ──────────────────────────────────────────────────────────────────────────────
# build — compile the backend, bundle the SPA
# ──────────────────────────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /app

COPY tsconfig.base.json ./
COPY packages/backend packages/backend
COPY packages/frontend packages/frontend

# Backend first: `nest build` emits `packages/backend/dist/`, which is what
# MikroORM discovers entities and migrations from (there is deliberately no
# `entitiesTs` — see `mikro-orm.config.ts`).
RUN npm run build --workspace packages/backend

# Then the SPA. `npm run build` here is `vue-tsc --build && vite build`: the
# type-check is kept ON PURPOSE. This image is the artefact the whole stack is
# judged on, and a type error caught here costs a minute, while one that slips
# through costs a debugging session against a container.
RUN npm run build --workspace packages/frontend

# ──────────────────────────────────────────────────────────────────────────────
# prod-deps — the same lockfile, without the build-time half
# ──────────────────────────────────────────────────────────────────────────────
# A fresh install rather than `npm prune`: pruning leaves the removed packages'
# directories behind in the layer that already recorded them, so the image keeps
# paying for them. This stage starts from nothing and is thrown away except for
# its `node_modules`.
#
# ⚠️ `--workspace packages/backend --include-workspace-root` narrows the install
# to what the running process actually needs. Without it npm would also install
# the frontend's runtime dependencies (vue, vuetify, pinia — tens of megabytes)
# which exist only inside the bundle the `build` stage already produced.
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/backend/package.json packages/backend/package.json
COPY packages/frontend/package.json packages/frontend/package.json

RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --workspace packages/backend --include-workspace-root

# ──────────────────────────────────────────────────────────────────────────────
# runtime
# ──────────────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime

WORKDIR /app/packages/backend

# `mikro-orm.config.ts` derives its paths from `__dirname`, not from the working
# directory or from NODE_ENV, so every entry point agrees on one layout and
# this flag is safe to set. It is what makes the backend cache the SPA's
# `index.html` in memory instead of re-reading it on every request.
ENV NODE_ENV=production

# Absolute, so it does not depend on the working directory a `docker compose
# run` might override. This is the path the `build` stage put the SPA at.
ENV SPA_DIST_PATH=/app/packages/frontend/dist

# The whole prod install, including the workspace symlinks npm creates under the
# root `node_modules/`. Copying the directory tree rather than cherry-picking
# `node_modules` keeps those links pointing at real directories.
COPY --from=prod-deps /app /app

COPY --from=build /app/packages/backend/dist /app/packages/backend/dist
COPY --from=build /app/packages/frontend/dist /app/packages/frontend/dist

# `psql` (for the one-shot `gravindex-seed` service to load the local seed
# below) and `ffmpeg` (for the waveform pipeline — `src/waveform/`, chained
# after every ingestion tick unless `WAVEFORM_ENABLED` says otherwise). Both
# installed as root, before the switch to an unprivileged user.
#
# ⚠️ `ffmpeg`'s absence is NOT a boot failure — `WaveformService` degrades to a
# per-episode warning if it is ever missing, the same rule `SPA_DIST_PATH`
# follows for a missing build. Installed anyway, because this is the ONE image
# that runs in the target deployment and there is no second image to add it to
# later.
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# The local, git-ignored snapshot of the content tables (`npm run db:export`
# produces it; a clone has none, and the seed then loads nothing) — what a
# fresh main database is seeded from. See `docker/seed.sh`. ⚠️ Absolute destination: WORKDIR is already
# `/app/packages/backend`, and a relative one here would nest it twice.
COPY packages/backend/seed /app/packages/backend/seed

# The seed guard, used only by the one-shot `gravindex-seed` service. It lives in
# this image because it needs `psql` and the seed file above; it is inert
# unless something overrides the entrypoint to call it.
COPY docker/seed.sh /usr/local/bin/gravindex-seed

# ⚠️ Unprivileged, and the uid matters: `node` is uid 1000 in the official
# images, which is also the uid that owns the local seed file on the host, if one
# exists. The `gravindex-seed` service reads it, which a root-only container could
# not do under the usual file modes.
USER node

EXPOSE 3000

# Not `npm start`: npm would sit in the process tree as PID 1 and swallow the
# SIGTERM that `app.enableShutdownHooks()` exists to receive.
CMD ["node", "dist/main"]
