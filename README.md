# Gravindex

**Índice gravinero** — una web para cortar, buscar y escuchar momentos del
podcast [gravina82](https://gravina82.com). Sin cuentas y sin registro:
cualquiera puede buscar clips, filtrarlos por tag, votarlos, etiquetarlos,
encolarlos en un reproductor que te sigue por toda la web, compartir esa cola
en un enlace, descargar un corte en mp3 y cortar uno nuevo desde el editor.

Los episodios no se alojan aquí. La web guarda sus datos (título, portada, fecha
y la URL del `.mp3`) y el navegador reproduce ese mp3 remoto saltando al segundo
donde empieza el corte. Un clip es, literalmente,
`(episodio, inicio, fin, título)`.

Monorepo de dos paquetes con workspaces de npm:

| Paquete | Qué es |
|---|---|
| `packages/backend` | NestJS 12 + MikroORM (PostgreSQL). Sirve la API bajo `/api` **y la propia SPA**, con las etiquetas Open Graph inyectadas para los enlaces compartidos |
| `packages/frontend` | Vue 3 + Vuetify + Vite, TypeScript estricto, arquitectura hexagonal |

## Arranque rápido 🚀

Solo hace falta **Docker**. Todo lo demás vive dentro.

```bash
cp .env.example .env      # y edítalo (ver abajo)
docker compose up
```

Eso levanta tres cosas, en este orden:

1. **`gravindex-db`** — PostgreSQL.
2. **`gravindex-api`** — el backend, que aplica las migraciones pendientes
   *antes* de escuchar en el puerto, y sirve la API y la SPA ya construida.
3. **`gravindex-seed`** — un contenedor de un solo uso que carga el seed local
   (`packages/backend/seed/`, fuera de git) y verifica la carga. Si ese fichero
   no existe, o la base ya tiene clips, no toca nada.

Cuando termine, la web está en **http://localhost:3000**. Un clon limpio no
trae datos: el catálogo empieza vacío y se llena con el feed del podcast
(`docker compose exec gravindex-api node dist/ingest/ingest.cli.js`). Ese
comando trae solo los episodios; los clips, votos y etiquetas de la comunidad
no viajan con el repositorio.

### Qué tienes que editar en `.env`

`.env.example` documenta todas las variables. La única que importa para
arrancar:

- **`JWT_SECRET`** — el backend no arranca sin ella. Genera una con
  `openssl rand -hex 32`.
- **`BACKEND_PORT`** / **`DB_PORT`** — cámbialos si esos puertos ya están
  ocupados en tu máquina. Si cambias `BACKEND_PORT`, cambia también `PUBLIC_URL`
  para que coincida, o los enlaces compartidos apuntarán al puerto equivocado.

> ⚠️ **No hay ningún comando en este repositorio que borre o recargue
> `gravindex-db`** — es la base de datos que se lleva a producción. Si alguna
> vez hace falta de verdad partir de cero, es un `docker volume rm gravindex_db`
> deliberado, a mano, nunca un script de una línea. Para refrescar el seed
> local con los datos actuales: `npm run db:export` (el resultado queda fuera
> de git).

### Comandos

```bash
npm start              # docker compose up (en primer plano)
npm run stack:up       # lo mismo, en segundo plano, reconstruyendo la imagen
npm run stack:logs     # seguir los logs del backend
npm run stack:down     # parar y borrar los contenedores (los datos se quedan)
npm run db:export      # refrescar el seed local (packages/backend/seed/) con los datos actuales

# Onda de audio: medir la onda real de todos los episodios de una vez
# (los nuevos se miden solos, encadenados tras cada ingesta — ver
# packages/backend/CLAUDE.md, "Waveforms")
docker compose exec gravindex-api node dist/waveform/waveform.cli.js
```

La carga de datos **no se repite** en cada `docker compose up`: si la base ya
tiene clips, el contenedor de carga se aparta.

> Los tests e2e corren contra su propia base descartable, nunca contra esta:
> `npm run test:db:up && npm run test:db:seed` (carga el fixture sintético de
> `test/testdb/fixture.sql`) y luego `npm run test:e2e`. Ver la `CLAUDE.md` de
> la raíz, "Tests and validation".

## Modo desarrollo 🛠️

Para tocar el frontend con recarga en caliente (HMR) no hace falta reconstruir
la imagen. Deja el backend en docker y saca solo el servidor de Vite:

```bash
docker compose up -d          # backend + base de datos, con sus datos
npm install                   # una vez
npm run dev:frontend          # Vite con HMR en http://localhost:5173
```

Y ya está: Vite hace de proxy de `/api` hacia
`http://localhost:${SERVER_PORT}`, que con los valores por defecto **es el
backend del compose**. No hay que configurar nada, y no hace falta CORS porque
para el navegador todo sale del mismo origen.

- Si cambiaste `BACKEND_PORT`, pon `BACKEND_URL=http://localhost:<ese-puerto>`
  en `.env` para que el proxy apunte bien.
- Si además quieres tocar el backend, párale el contenedor
  (`docker compose stop gravindex-api`) y usa `npm run dev` en la raíz, que
  levanta backend y frontend a la vez. Necesitarás `CORS=true` solo si te saltas
  el proxy de Vite apuntando `VITE_API_BASE_URL` a un origen absoluto.

Después de tocar el frontend, para ver el resultado tal y como lo servirá el
backend (SPA construida + etiquetas Open Graph inyectadas), reconstruye la
imagen: `npm run stack:up`.

### Tests

```bash
npm test               # unitarios de los dos paquetes
npm run lint
npm run type-check
```

## Descarga de cortes

El botón de descarga de cada fila entrega un `.mp3` completo con solo el corte.
Se corta **en el navegador**, copiando fotogramas del mp3 original: no hay
recodificación ni procesamiento de audio en el servidor. La petición pasa por
`GET /api/episodes/:id/audio` únicamente porque gravina82.com no envía cabeceras
CORS; ese extremo reenvía los bytes sin tocarlos.

## Construido con

- [NestJS](https://nestjs.com/) + [MikroORM](https://mikro-orm.io/) sobre PostgreSQL
- [Vue 3](https://vuejs.org/) + [Vuetify](https://vuetifyjs.com/) + [Vite](https://vite.dev/)
- [vite-plugin-pwa](https://vite-pwa-org.netlify.app/): la web se puede instalar en
  el móvil o en el escritorio y se actualiza sola, sin preguntar nada. ⚠️ El
  _service worker_ solo existe en una build de producción: con `npm run dev` no se
  registra ninguno, a propósito.

## Autor ✒️

- [Dicren](https://github.com/dicren)

## Licencia 📄

[MIT](LICENSE) — el código. Todo el contenido del podcast es propiedad de
[gravina82](https://gravina82.com/).

### Atribución

Las imágenes de marca no están cubiertas por la MIT. Son arte de
[gravina82](https://gravina82.com/) y se incluyen porque forman parte de su
identidad en la web:

- `packages/frontend/src/assets/`: el logotipo, la cabecera con caricaturas de
  dos personas del podcast, las ilustraciones de la ficha de episodio y la
  fotografía de la banda del reproductor.
- `packages/frontend/public/`: el favicon (`gravicon.ico`) y los iconos de la
  aplicación instalable (`icons/`).

Si quieres reutilizarlas fuera de este proyecto, pide permiso a gravina82.
Un fork debería sustituirlas por su propio arte.

---
⌨️ con ❤️ por [dicren](https://github.com/dicren) para [gravina82](https://gravina82.com/)
