#!/usr/bin/env bash
# Brings the main stack (gravindex-db, gravindex-api, gravindex-seed) up from a
# clean state: if those containers already exist — running or not — they are
# stopped and removed first, then the stack is started fresh with `--build`.
#
# ⚠️ Never touches the `db` volume: `docker compose down` (no `-v`) only drops
# containers and the network, and `gravindex-db` must never be wiped (see the
# root CLAUDE.md, "Running it"). Never touches the `test` profile either —
# `docker compose down`/`up` without `--profile` only reaches the
# default-profile services, so `gravindex-test-db` is left exactly as it was.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f .env ]; then
  echo "==> No existe .env — copia .env.example a .env y ajusta JWT_SECRET antes de continuar." >&2
  exit 1
fi

STACK_SERVICES=(gravindex-db gravindex-api gravindex-seed)

PORT="$(grep -E '^BACKEND_PORT=' .env | tail -1 | cut -d= -f2- || true)"
PORT="${PORT:-3000}"

EXISTING="$(docker compose ps -aq "${STACK_SERVICES[@]}" 2>/dev/null || true)"
if [ -n "$EXISTING" ]; then
  echo "==> El stack ya tenía contenedores, parándolo antes de levantarlo de nuevo"
  docker compose down
else
  echo "==> No había nada levantado"
fi

# A non-docker backend (e.g. `node dist/main` started by hand) can still be
# holding the same host port after the compose down above frees docker's
# share of it — stop it too, or `up` below fails with "address already in use".
HOST_PID="$(ss -tlnp 2>/dev/null | grep ":$PORT " | grep -oP 'pid=\K[0-9]+' | head -1 || true)"
if [ -n "$HOST_PID" ]; then
  echo "==> El puerto $PORT lo tiene un proceso fuera de docker (pid $HOST_PID), parándolo"
  kill "$HOST_PID" 2>/dev/null || true
  for _ in $(seq 1 20); do
    ss -tln 2>/dev/null | grep -q ":$PORT " || break
    sleep 0.5
  done
  if ss -tln 2>/dev/null | grep -q ":$PORT "; then
    kill -9 "$HOST_PID" 2>/dev/null || true
    sleep 1
  fi
  rm -f .local/backend.pid
fi

echo "==> Levantando el stack de 0 (build + up -d)"
docker compose up -d --build "${STACK_SERVICES[@]}"

# Cada rebuild retagea gravindex-api:2.0.0 y deja la imagen anterior como
# <none>, huérfana pero ocupando disco. Solo las de este proyecto (por label,
# la misma que pone `docker compose build`), nunca `docker image prune -a`.
echo "==> Limpiando imágenes de gravindex huérfanas del build anterior"
docker image prune -f --filter "label=com.docker.compose.project=gravindex" >/dev/null

echo "==> Esperando a que gravindex-api responda en /api/health (puerto $PORT)"
for _ in $(seq 1 60); do
  if curl -s -m 2 -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/health" 2>/dev/null | grep -q '^200$'; then
    echo "==> Listo: http://localhost:$PORT"
    curl -s "http://localhost:$PORT/api/health"; echo
    docker compose ps "${STACK_SERVICES[@]}"
    exit 0
  fi
  sleep 1
done

echo "==> gravindex-api no respondió a tiempo, revisa los logs:" >&2
docker compose logs --tail=60 gravindex-api >&2
exit 1
