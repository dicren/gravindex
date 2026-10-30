# Despliegue

Producción es **un servidor** (`prod.dicren.com`) con `docker-compose.prod.yml`:
Postgres y la API (que sirve también la SPA). El dominio público es
**https://indice.gravina82.com**. TLS y el 80/443 son del **Caddy de borde
compartido** en `/opt/edge`, que también atiende buitrelista.es; su
configuración vive en el repositorio de buitresa (`deploy/edge/Caddyfile`).

Se siguen publicando **dos imágenes propias** con el mismo tag:
`ghcr.io/dicren/gravindex:<tag>` y `ghcr.io/dicren/gravindex-caddy:<tag>` (Caddy
con el módulo de rate limiting; se construye en `deploy/caddy/Dockerfile`). El
borde ya no usa la segunda: la suya se construye en el repo de buitresa.

## Desplegar

Un tag, y nada más:

```bash
git tag -a v2.0.1 -m "v2.0.1"
git push origin v2.0.1
```

`.github/workflows/pipeline.yml` corre lint, tipos, tests unitarios, Playwright,
publica la imagen de la app (y la de Caddy, que el borde ya no usa), despliega por SSH y publica la release con la entrada
del changelog de `packages/frontend/src/vue/views/AboutView.vue`. **Un push a
`develop` no despliega**, solo pasa los tests rápidos.

Desde el servidor, como root:

```bash
/usr/local/bin/gravindex-deploy v2.0.1
```

La clave de `deploy` que usa Actions tiene una orden forzada: solo puede ejecutar
ese script, y el script solo acepta un tag con forma de versión.

## Rollback

```bash
# en el servidor, como root
/usr/local/bin/gravindex-deploy v2.0.0
```

El despliegue vuelve solo al tag anterior si la API o la URL pública no responden.

## Operación

```bash
cd /opt/gravindex
docker compose -f docker-compose.prod.yml --env-file .env ps
docker compose -f docker-compose.prod.yml --env-file .env logs -f gravindex-api
journalctl -t gravindex-deploy -t gravindex-watchdog -t gravindex-backup -t gravindex-heartbeat -f
systemctl list-timers gravindex-watchdog.timer gravindex-backup.timer gravindex-heartbeat.timer
```

Se levanta solo con `restart: unless-stopped`, `gravindex.service` (arranque),
`live-restore` (reinicio del daemon) y `gravindex-watchdog.timer`, que reinicia
contenedores `unhealthy`. Fuera del servidor, `gravindex-heartbeat.timer` avisa a
healthchecks.io si la web deja de responder.

## Rate limiting

En `deploy/Caddyfile`, por IP y por minuto: `login` 5, `audio` 60, escrituras 30,
`/api` 300.

## Backups

`gravindex-backup.timer` (03:30) deja un `pg_dump` comprimido en
`/var/backups/gravindex/` (14 días) y envía una copia por correo si hay relay
configurado.

Restaurar en una base vacía (⚠️ borra lo que haya en esa base):

```bash
gunzip -c /var/backups/gravindex/<fichero>.sql.gz |
  docker compose -f docker-compose.prod.yml --env-file .env exec -T gravindex-db \
  psql -U gravindex -d gravindex -v ON_ERROR_STOP=1
```

El correo sale por un relay SMTP autenticado (el del proveedor del buzón, p. ej.
`ssl0.ovh.net:465`), nunca directo desde el VPS: el dominio tiene su MX en OVH y
un envío directo fallaría SPF.

## Datos iniciales y administrador

El seed es un dump **solo de datos**: las tablas las crean las migraciones al
arrancar la API.

```bash
cd /opt/gravindex
docker compose -f docker-compose.prod.yml --env-file .env --profile seed run --rm gravindex-seed
```

El administrador se inserta a mano, con el hash ya calculado:

```bash
npm run build -w packages/backend
npm run hash-password -w packages/backend -- '<contraseña>'
```

```sql
insert into "user" (username, password_hash) values ('<usuario>', '$2b$10$…');
```

## Secretos y entorno

En GitHub: `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `DEPLOY_HOST`, `DEPLOY_USER`.

En el servidor, todos en modo 0600 y ninguno en git:

| Fichero | Qué lleva |
|---|---|
| `/opt/gravindex/.env` | `DB_PASSWORD`, `JWT_SECRET`, `PUBLIC_URL`, `IMAGE_TAG`, ingesta |
| `/etc/gravindex/heartbeat.env` | `HEALTHCHECKS_PING_URL` |
| `/etc/gravindex/mail.env` | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, `MAIL_TO` |

Genera los secretos con `openssl rand -hex 32`. El destinatario de los backups es
`MAIL_TO`: no hay ninguna dirección escrita en el repositorio.

## Actualizar los scripts del servidor

```bash
cd /opt/gravindex
sudo git fetch origin develop
sudo git checkout -f origin/develop -- deploy/server
sudo deploy/server/install.sh
```

`install.sh` es idempotente y **no** arranca el stack en un servidor nuevo.

## Bootstrap desde cero

Docker Engine con `live-restore`, las reglas `forward` de `docker0`/`br-*` en
`/etc/nftables.conf` (sin ellas la política `drop` del host tira todo el tráfico
de los contenedores), el usuario `deploy` con la orden forzada y su `AllowUsers`,
el clon en `/opt/gravindex`, `.env`, `sudo deploy/server/install.sh`, rellenar
`heartbeat.env` y `mail.env`, y el primer `gravindex-deploy <tag>`.
