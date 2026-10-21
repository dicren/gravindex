# Despliegue

Producción es **un servidor** (`prod.dicren.com`, `54.37.157.210`) con **un
stack de Docker Compose** y tres contenedores:

| Contenedor | Qué es |
|---|---|
| `gravindex-prod-gravindex-db-1` | PostgreSQL 16, sin puerto publicado |
| `gravindex-prod-gravindex-api-1` | La imagen de GHCR: API + SPA, migraciones al arrancar |
| `gravindex-prod-caddy-1` | TLS automático y los puertos 80/443 |

El dominio público es **https://indice.gravina82.com**. Caddy obtiene y renueva
el certificado de Let's Encrypt solo; no hay certbot ni certificados en el host.

```
GitHub Actions  ──(tag v*)──▶  tests  ──▶  imagen en GHCR  ──(SSH)──▶  deploy
                                                                        │
                                                          docker compose pull + up -d
                                                                        │
                                                          healthcheck falla → rollback
```

## Desplegar

Un despliegue es **un tag**, y nada más:

```bash
git tag -a v2.0.1 -m "v2.0.1"
git push origin v2.0.1
```

Eso dispara `.github/workflows/pipeline.yml`: lint, tipos, tests unitarios,
Playwright completo, build de la imagen, push a `ghcr.io/dicren/gravindex:v2.0.1`
y, al final, `ssh deploy@prod.dicren.com v2.0.1`. La web no cambia hasta que
todas las puertas anteriores han pasado. Si el despliegue termina bien, se crea
además la **release** en GitHub.

**Un push a `develop` no despliega**: solo ejecuta la mitad rápida del pipeline.

### La release

La release se genera sola con la entrada del changelog que vive en
`packages/frontend/src/vue/views/AboutView.vue`, no con la lista de commits. El
job `release` extrae la entrada de la versión del tag con
`deploy/changelog-notes.mjs` y crea (o actualiza, si se relanza el job) la
release en GitHub.

⚠️ Por eso, al subir la versión, hay que añadir su entrada en `AboutView.vue`
antes de crear el tag. Si el tag no tiene entrada, el script sale con error y no
se publica release: una release con las notas vacías es peor que un job rojo.

### Desplegar a mano

Solo para una emergencia, desde una máquina con la clave de despliegue:

```bash
ssh deploy@prod.dicren.com v2.0.1
```

La clave de ese usuario tiene una orden forzada: lo único que puede ejecutar es
`gravindex-deploy`, y el argumento tiene que ser un tag con forma de versión.

## Rollback

El despliegue ya lo hace solo si el healthcheck falla. Para volver atrás a
propósito, se despliega el tag anterior:

```bash
ssh deploy@prod.dicren.com v2.0.0
```

El script guarda el tag desplegado en `/var/lib/gravindex/deployed-tag` y
descarga la imagen de ese tag, que sigue en GHCR.

## Operación

```bash
cd /opt/gravindex

# Estado
docker compose -f docker-compose.prod.yml --env-file .env ps

# Logs (rotados por Docker: 10 MB × 3 por servicio)
docker compose -f docker-compose.prod.yml --env-file .env logs -f gravindex-api

# Logs del sistema (deploy, watchdog, backups)
journalctl -t gravindex-deploy -t gravindex-watchdog -t gravindex-backup -f

# Timers
systemctl list-timers gravindex-watchdog.timer gravindex-backup.timer
```

### Qué se levanta solo

| Mecanismo | Cubre |
|---|---|
| `restart: unless-stopped` en los tres servicios | El proceso muere o el contenedor sale |
| `gravindex.service` (systemd) | Que el stack vuelva al arrancar la máquina |
| `live-restore` en el daemon | Que los contenedores sobrevivan a un reinicio de Docker |
| `gravindex-watchdog.timer` (cada minuto) | Un contenedor **vivo pero colgado**: si el healthcheck dice `unhealthy`, lo reinicia |
| `gravindex-deploy` | Un despliegue que deja la API sin responder: rollback al tag anterior |

Docker por sí solo **no** reinicia un contenedor `unhealthy`; solo reacciona a
que el proceso termine. El watchdog existe para ese hueco.

## Backups

`gravindex-backup.timer` lanza `gravindex-backup` cada noche a las 03:30 (hora
local). Deja un `pg_dump` comprimido en `/var/backups/gravindex/` y conserva 14
días. Cada fichero se valida con `gzip -t` antes de contar como bueno, así que un
dump roto nunca rota uno sano.

```bash
ls -lh /var/backups/gravindex/
```

Restaurar en una base vacía (⚠️ `--clean --if-exists` **borra** lo que haya en
esa base; nunca lo apuntes a la de producción sin querer):

```bash
cd /opt/gravindex
gunzip -c /var/backups/gravindex/gravindex-20261021T013000Z.sql.gz |
  docker compose -f docker-compose.prod.yml --env-file .env exec -T gravindex-db \
  psql -U gravindex -d gravindex -v ON_ERROR_STOP=1
```

Los backups están **en el mismo servidor**. Protegen de un borrado o de una
migración mala, no de perder el VPS. Para eso hace falta copiarlos fuera
(`rclone`, S3, lo que sea) desde el mismo timer.

## Datos iniciales y administrador

El seed (`packages/backend/seed/gravindex.seed.sql`) es un dump **solo de
datos**: las tablas las crean las migraciones cuando arranca la API. Por eso el
orden es siempre migrar → cargar.

```bash
cd /opt/gravindex
# Carga el fichero de ./seed/ solo si la base no tiene clips todavía.
docker compose -f docker-compose.prod.yml --env-file .env --profile seed run --rm gravindex-seed
```

El usuario administrador **no viene en el seed** y se inserta a mano, con el
hash bcrypt ya calculado:

```bash
npm run build -w packages/backend
npm run hash-password -w packages/backend -- 'la-contraseña'
```

```sql
insert into "user" (username, password_hash) values ('dicren', '$2b$10$…');
```

`"user"` va entre comillas porque es palabra reservada en Postgres.

## Secretos

En el repositorio de GitHub:

| Secreto | Qué es |
|---|---|
| `DEPLOY_SSH_KEY` | Clave privada ed25519 del usuario `deploy` del servidor |
| `DEPLOY_KNOWN_HOSTS` | Línea de `known_hosts` del servidor, para `StrictHostKeyChecking=yes` |
| `DEPLOY_HOST` | `prod.dicren.com` |
| `DEPLOY_USER` | `deploy` |

En el servidor, `/opt/gravindex/.env` (modo 0600, nunca en git): `DB_PASSWORD`,
`JWT_SECRET`, `PUBLIC_URL`, `IMAGE_TAG` y la configuración de ingesta. Genera los
secretos con `openssl rand -hex 32`.

El usuario `deploy` no tiene contraseña y su `authorized_keys` lleva
`restrict,command="sudo /usr/local/bin/gravindex-deploy"`. La clave solo puede
lanzar ese script, y el script solo acepta un tag de versión.

## Actualizar los scripts del servidor

Los ficheros de `deploy/server/` se instalan en `/usr/local/bin` y
`/etc/systemd/system`, y **no** cambian con el checkout de un tag. Para
actualizarlos:

```bash
cd /opt/gravindex
sudo git fetch origin develop
sudo git checkout -f origin/develop -- deploy/server
sudo deploy/server/install.sh
```

`install.sh` es idempotente: reinstala los scripts, recarga systemd y deja los
timers activos.

## Bootstrap desde cero

Lo que ya está hecho en `prod.dicren.com`, por si hay que reconstruirlo:

1. Debian 13, firewall con 22/80/443 abiertos (ya lo estaba) y la cadena
   `forward` de `/etc/nftables.conf` con las reglas de `docker0`/`br-*`. Sin
   ellas la política `drop` del host tira todo el tráfico reenviado y ni los
   puertos publicados ni las peticiones salientes de los contenedores
   funcionan.
2. Docker Engine + plugin de Compose desde el repositorio oficial de Docker.
   `/etc/docker/daemon.json` con `live-restore` y rotación de logs por defecto.
3. Usuario `deploy` sin contraseña, con la clave pública de GitHub Actions en
   `authorized_keys` y la regla de sudoers que permite solo `gravindex-deploy`.
   `AllowUsers` de sshd tiene que incluirlo.
4. `git clone https://github.com/dicren/gravindex.git /opt/gravindex`.
5. `/opt/gravindex/.env` con los secretos, `PUBLIC_URL=https://indice.gravina82.com`
   e `IMAGE_TAG` del primer tag.
6. `sudo deploy/server/install.sh` (instala scripts y unidades; **no** arranca
   el stack, porque en un servidor nuevo todavía no hay imagen).
7. El primer `ssh deploy@prod.dicren.com <tag>` (o un `systemctl start
   gravindex.service` con la imagen ya cargada) levanta el stack. Después, el
   seed y el alta del administrador.
