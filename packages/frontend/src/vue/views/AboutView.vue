<script setup lang="ts">
/**
 * The static page. Route `/about`, name `about`.
 *
 * ⚠️ **Every word below is content, copied verbatim.** This is the one screen in
 * the app that is nothing BUT copy: the author's note about why the site exists,
 * who to write to, and a hand-written changelog going back to the first public
 * release in June 2019. Nothing here is placeholder text and nothing here should
 * be rewritten, tidied, translated or reordered.
 *
 * ⚠️ That includes the typos. `Ayudame` (no accent), `sobretodo`, `ruls` for
 * `urls`, and `colaborar con en apartado técnico` are all part of the author's
 * text. They are somebody's voice, they are what a returning visitor has read
 * for six years, and they stay as they are (root `AGENTS.md`).
 * A spellcheck pass here is a content change and needs to be somebody's decision,
 * not a side effect of a refactor.
 *
 * ⚠️ **The `2.0.3` entry belongs to the current release.** It moves in lockstep
 * with this package's `version` (see below), and the two are kept in step by
 * hand.
 *
 * Two deliberate, recorded departures in the markup, neither of which touches
 * a word:
 *
 * - The four headings are peers, so they are `<h2>`s here. The level is about
 *   the outline, and `GravTitle` sets the size separately.
 * - The version is printed in the FOOTER, not on this page: `GravFooter` reads the `__APP_VERSION__` constant Vite bakes
 *   in from `package.json`. Nothing here restates it. ⚠️ That number is `2.0.3`,
 *   matching the entry below; the two still move together by hand and there is
 *   nothing enforcing it.
 */
import GravTitle from '@/components/GravTitle.vue';
</script>

<template>
  <v-container class="about">
    <GravTitle :level="2" size="lg">¿Por qué?</GravTitle>
    <p>
      ¿Por qué no? Si estás aquí es porque te gusta gravina, ¿No sería genial poder tener todos los
      buenos momentos del podcast guardados en un mismo sitio? Ayudame a conseguirlo colaborando en
      esta página.<br />
      Llevaba tiempo pensando en hacer algo como esto, y cuando apareció el
      <a
        href="https://docs.google.com/spreadsheets/d/1K_jSPXo0cLzOm7NeWSohPoRnfSoaWzDsFjjMc-n6PFY"
        target="_blank"
        rel="noopener"
        >Índice gravinero
      </a>
      obra de
      <a target="_blank" rel="noopener" href="https://twitter.com/ICMarja">Iván Caballero</a>
      me pareció el mejor momento.<br />
      Mi intención es ir añadiendo funcionalidades a la página con el tiempo, sobretodo si tiene
      buena acogida.
    </p>

    <GravTitle :level="2" size="lg">¿Cómo puedo colaborar?</GravTitle>
    <p>
      Puedes añadir nuevos clips a la biblioteca utilizando el botón de
      <RouterLink :to="{ name: 'creatorSearch' }">añadir</RouterLink>
      corte.
      <br />
      También puedes <a href="mailto:me@dicren.com">escribirme</a> si encuentras algún fallo en la
      web o si se te ocurre alguna idea. <br />
      Si quieres colaborar con en apartado técnico puedes encontrar el código de la página en
      <a href="https://github.com/DiCrEn/gravindex">github</a>.
    </p>

    <GravTitle :level="2" size="lg">La web</GravTitle>
    <p>
      Todo el contenido de esta web es propiedad de
      <a href="https://gravina82.com/">Gravina82</a> y la web puedes encontrarla en
      <a href="https://github.com/DiCrEn/gravindex">github</a>. <br />
      La intención de esta página es tener un índice de fácil acceso a todos esos grandes momentos
      gravineros.
    </p>

    <GravTitle :level="2" size="lg">Versiones</GravTitle>

    <!-- ⚠️ The changelog. Verbatim, every entry, in this order. `<strong>` carries
         the emphasis, so it is real markup rather than a class. -->
    <ul class="about__changelog">
      <li>
        <strong>2.0.3</strong> - 30/10/2026
        <ul>
          <li>
            La web comparte el proxy con buitrelista.es: un solo borde gestiona el certificado y los
            límites de peticiones de los dos sitios, sin cambios visibles en la web
          </li>
        </ul>
      </li>
      <li>
        <strong>2.0.2</strong> - 27/10/2026
        <ul>
          <li>
            La cola sigue sonando con la pestaña en segundo plano o la pantalla apagada, y la
            pantalla de bloqueo muestra lo que suena con sus controles
          </li>
          <li>
            Si el audio se corta, se reintenta una vez desde donde estaba; si vuelve a fallar, la
            cola pasa al siguiente y avisa una sola vez
          </li>
          <li>
            Botón de corte anterior: vuelve al corte de antes o reinicia el que suena si llevas más
            de tres segundos
          </li>
          <li>
            Dos pestañas de la web comparten la cola y el sonido: la que empieza a sonar manda y la
            otra se calla
          </li>
        </ul>
      </li>
      <li>
        <strong>2.0.1</strong> - 21/10/2026
        <ul>
          <li>
            Límite de peticiones por IP para frenar abusos, con límites más estrictos en el acceso y
            en la descarga de audio
          </li>
          <li>
            Vigilancia externa que avisa si la web deja de responder, incluso si el servidor entero
            se cae
          </li>
          <li>Copia diaria de la base de datos por correo, además de la copia local</li>
        </ul>
      </li>
      <li>
        <strong>2.0.0</strong> - 20/10/2026
        <ul>
          <li>
            Rediseño completo de la web: nueva imagen, un único reproductor fijo al pie de la
            pantalla y listas infinitas en lugar de paginación
          </li>
          <li>
            Cola de reproducción: añade cortes y episodios enteros, reordénalos, quítalos y
            compártela con un enlace. Recuerda qué estabas escuchando y en qué segundo lo dejaste
          </li>
          <li>Momentos: marca al vuelo el segundo que suena y guárdalo para cortarlo más tarde</li>
          <li>
            Ya se pueden escuchar episodios enteros desde su ficha, con los cortes dibujados sobre
            la onda
          </li>
          <li>
            Onda de audio real de cada episodio, descarga de cortes y botón «Al azahar» para saltar
            a uno cualquiera
          </li>
          <li>Vista de calendario de episodios, con los diecisiete años del podcast</li>
          <li>
            Editor de cortes renovado y cómodo también en el móvil, buscador de episodios
            superpuesto y filtros fijos al hacer scroll
          </li>
          <li>La web se puede instalar como aplicación y se actualiza sola</li>
          <li>Eliminado el voto negativo: ahora solo se puede votar a favor</li>
        </ul>
      </li>
      <li>
        <strong>1.1.1</strong> - 31/03/2020
        <ul>
          <li>
            Arreglado fallo al cambiar de página después de limpiar el filtro de búsqueda en la
            biblioteca gravinera
          </li>
        </ul>
      </li>
      <li>
        <strong>1.1.0</strong> - 31/03/2020
        <ul>
          <li>Mejorado el buscador de episodios</li>
          <li>Optimizada la web</li>
          <li>Ahora en las ruls sólo aparecen los parámetros necesarios</li>
          <li>Metadatos al compartir clips en redes sociales</li>
          <li>El buscador de tags no sugiere tags repetidos</li>
          <li>Ordenado en orden alfabético el buscador de tags</li>
          <li>Arreglados algunos pequeños errores</li>
          <li>Arreglados errores de diseño</li>
        </ul>
      </li>
      <li>
        <strong>1.0.1</strong> - 30/03/2020
        <ul>
          <li>Mejorada la búsqueda</li>
        </ul>
      </li>
      <li>
        <strong>1.0.0</strong> - 09/06/2019
        <ul>
          <li>Primera versión pública</li>
        </ul>
      </li>
    </ul>
  </v-container>
</template>

<style scoped>
/* `p { margin-bottom: 2rem }` — the page reads as three long notes, and
   the air between them is what keeps it readable. */
.about p {
  margin-bottom: 2rem;
}

/* ⚠️ Vuetify resets lists to `list-style: none`, so the markers are turned back
   on here: disc at the top level, circle one step in. The `padding-inline-start`
   gives the markers room: Vuetify's container does not provide the section
   padding in the same place, and without it the bullets sit outside the
   viewport on a phone. */
.about__changelog {
  padding-inline-start: 1.25rem;
}

.about__changelog li {
  list-style-type: disc;
}

.about__changelog li li {
  margin-left: 2rem;
  list-style-type: circle;
}
</style>
