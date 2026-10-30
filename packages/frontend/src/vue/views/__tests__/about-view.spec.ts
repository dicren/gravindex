import { beforeAll, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory, type Router } from 'vue-router';
import { defineComponent } from 'vue';
import vuetify from '@/plugins/vuetify';
import AboutView from '@/views/AboutView.vue';
import { freshPinia, stubBrowserApis } from '@/components/__tests__/mount-with-vuetify';

/**
 * The static page — the one screen in the app that is nothing but copy.
 *
 * ⚠️ **This file asserts content, character for character.** The changelog is
 * hand-written and goes back to the first public release in June 2019; it is a
 * record of what happened, not documentation to be regenerated. So is the prose
 * around it, typos included (`Ayudame`, `sobretodo`, `ruls`, `colaborar con en
 * apartado técnico`) — they are part of the author's copy and a tidy-up here is
 * a content change nobody asked for.
 *
 * Nothing else in the codebase would catch either kind of edit, which is why the
 * assertions are equality rather than `toContain`.
 */

/** `wrapper.text()` keeps the template's own indentation and line breaks; the
 *  browser collapses all of it. Compare what a reader sees. */
function squish(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

const Blank = defineComponent({ template: '<div />' });

function aboutRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Blank },
      { path: '/creator', name: 'creatorSearch', component: Blank },
      { path: '/about', name: 'about', component: AboutView },
    ],
  });
}

function mountAbout() {
  return mount(AboutView, { global: { plugins: [freshPinia(), vuetify, aboutRouter()] } });
}

beforeAll(stubBrowserApis);

describe('the changelog', () => {
  it('lists the nine released versions, newest first', () => {
    const wrapper = mountAbout();

    const versions = wrapper.findAll('.about__changelog > li > strong').map((node) => node.text());
    expect(versions).toEqual([
      '2.0.4',
      '2.0.3',
      '2.0.2',
      '2.0.1',
      '2.0.0',
      '1.1.1',
      '1.1.0',
      '1.0.1',
      '1.0.0',
    ]);

    wrapper.unmount();
  });

  it('keeps every entry verbatim, with its date', () => {
    const wrapper = mountAbout();
    const entries = wrapper.findAll('.about__changelog > li');
    expect(entries).toHaveLength(9);

    const dated = entries.map((entry) => squish(entry.text()).split(' ').slice(0, 3).join(' '));
    expect(dated).toEqual([
      '2.0.4 - 30/10/2026',
      '2.0.3 - 30/10/2026',
      '2.0.2 - 27/10/2026',
      '2.0.1 - 21/10/2026',
      '2.0.0 - 20/10/2026',
      '1.1.1 - 31/03/2020',
      '1.1.0 - 31/03/2020',
      '1.0.1 - 30/03/2020',
      '1.0.0 - 09/06/2019',
    ]);

    const bulletsOf = (index: number): string[] =>
      entries[index]?.findAll('li').map((bullet) => squish(bullet.text())) ?? [];

    // ⚠️ Releases that changed nothing a visitor can see say exactly this and
    // nothing more: the page is public, and internal detail belongs in git.
    expect(bulletsOf(0)).toEqual(['Cambios de infraestructura']);
    expect(bulletsOf(1)).toEqual(['Cambios de infraestructura']);
    expect(bulletsOf(2)).toEqual([
      'La cola sigue sonando con la pestaña en segundo plano o la pantalla apagada, y la pantalla de bloqueo muestra lo que suena con sus controles',
      'Si el audio se corta, se reintenta una vez desde donde estaba; si vuelve a fallar, la cola pasa al siguiente y avisa una sola vez',
      'Botón de corte anterior: vuelve al corte de antes o reinicia el que suena si llevas más de tres segundos',
      'Dos pestañas de la web comparten la cola y el sonido: la que empieza a sonar manda y la otra se calla',
    ]);
    expect(bulletsOf(3)).toEqual([
      'Límite de peticiones por IP para frenar abusos, con límites más estrictos en el acceso y en la descarga de audio',
      'Vigilancia externa que avisa si la web deja de responder, incluso si el servidor entero se cae',
      'Copia diaria de la base de datos por correo, además de la copia local',
    ]);
    expect(bulletsOf(4)).toEqual([
      'Rediseño completo de la web: nueva imagen, un único reproductor fijo al pie de la pantalla y listas infinitas en lugar de paginación',
      'Cola de reproducción: añade cortes y episodios enteros, reordénalos, quítalos y compártela con un enlace. Recuerda qué estabas escuchando y en qué segundo lo dejaste',
      'Momentos: marca al vuelo el segundo que suena y guárdalo para cortarlo más tarde',
      'Ya se pueden escuchar episodios enteros desde su ficha, con los cortes dibujados sobre la onda',
      'Onda de audio real de cada episodio, descarga de cortes y botón «Al azahar» para saltar a uno cualquiera',
      'Vista de calendario de episodios, con los diecisiete años del podcast',
      'Editor de cortes renovado y cómodo también en el móvil, buscador de episodios superpuesto y filtros fijos al hacer scroll',
      'La web se puede instalar como aplicación y se actualiza sola',
      'Eliminado el voto negativo: ahora solo se puede votar a favor',
    ]);
    expect(bulletsOf(5)).toEqual([
      'Arreglado fallo al cambiar de página después de limpiar el filtro de búsqueda en la biblioteca gravinera',
    ]);
    expect(bulletsOf(6)).toEqual([
      'Mejorado el buscador de episodios',
      'Optimizada la web',
      // ⚠️ `ruls`, not `urls`. The typo is the author's and stays.
      'Ahora en las ruls sólo aparecen los parámetros necesarios',
      'Metadatos al compartir clips en redes sociales',
      'El buscador de tags no sugiere tags repetidos',
      'Ordenado en orden alfabético el buscador de tags',
      'Arreglados algunos pequeños errores',
      'Arreglados errores de diseño',
    ]);
    expect(bulletsOf(7)).toEqual(['Mejorada la búsqueda']);
    expect(bulletsOf(8)).toEqual(['Primera versión pública']);

    wrapper.unmount();
  });

  it('keeps internal detail out of the public page', () => {
    const wrapper = mountAbout();

    // ⚠️ A release that only moved infrastructure says so in one generic line.
    // The prose of this page is read by the podcast's audience, so the proxies,
    // the backups and the servers stay in git — and a neighbouring project's
    // name has no business here either.
    const text = squish(wrapper.text());
    expect(text).not.toContain('buitrelista');
    expect(text).not.toContain('proxy');

    wrapper.unmount();
  });
});

describe('the prose', () => {
  it('keeps the four section headings, in order and in Spanish', () => {
    const wrapper = mountAbout();

    expect(wrapper.findAll('.grav-title').map((node) => node.text())).toEqual([
      '¿Por qué?',
      '¿Cómo puedo colaborar?',
      'La web',
      'Versiones',
    ]);

    wrapper.unmount();
  });

  it('keeps the author’s own spelling — this is a voice, not a draft', () => {
    const text = squish(mountAbout().text());

    // ⚠️ Four typos, all part of the author's copy. A spellcheck here is somebody's
    // decision to make, not a side effect of a refactor.
    expect(text).toContain('Ayudame a conseguirlo colaborando en esta página.');
    expect(text).toContain('sobretodo si tiene buena acogida');
    expect(text).toContain('Si quieres colaborar con en apartado técnico');
    expect(text).toContain('Ahora en las ruls sólo aparecen los parámetros necesarios');
  });

  it('points at the clip editor, gravina82 and the repository', () => {
    const wrapper = mountAbout();

    // The only internal link on the page, and it is how someone gets from
    // "¿Cómo puedo colaborar?" to actually cutting a clip.
    expect(wrapper.find('a[href="/creator"]').text()).toBe('añadir');

    const externals = wrapper.findAll('a[href^="http"]').map((node) => node.attributes('href'));
    expect(externals).toContain('https://gravina82.com/');
    expect(externals).toContain('https://github.com/DiCrEn/gravindex');
    expect(externals).toContain('https://twitter.com/ICMarja');

    // "escribirme" is an address now, not a Twitter handle.
    expect(wrapper.find('a[href="mailto:me@dicren.com"]').text()).toBe('escribirme');
    expect(externals).not.toContain('https://twitter.com/dicren');

    wrapper.unmount();
  });
});
