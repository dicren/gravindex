# syntax=docker/dockerfile:1
#
# Caddy with the rate-limit module.
#
# The stock `caddy:2-alpine` image has no rate limiting: `rate_limit` is a
# third-party module, and the official image ships only the standard modules.
# This image is built by the `image` job in `.github/workflows/pipeline.yml`,
# pushed to `ghcr.io/dicren/gravindex-caddy:<tag>` under the SAME tag as the
# application, and pulled by `docker-compose.prod.yml`.
#
# ⚠️ The module is pinned to a commit, not `@latest`. A release whose proxy
# starts behaving differently because a Go module moved is not a release; when
# the plugin is updated, the new commit is a visible diff in this file.
#
# ⚠️ `caddy:2-builder` already carries Go, `xcaddy` and the Caddy source. The
# binary it produces is static, so the Alpine runtime below is enough.
ARG CADDY_VERSION=2

FROM caddy:${CADDY_VERSION}-builder AS builder

RUN xcaddy build \
    --with github.com/mholt/caddy-ratelimit@5625512f24f6f59d6f64fb3aafe5eecff0b286db

FROM caddy:${CADDY_VERSION}-alpine

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
