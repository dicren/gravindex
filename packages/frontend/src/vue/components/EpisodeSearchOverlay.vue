<script setup lang="ts">
/**
 * `Añadir corte` — a floating episode search over whatever you were looking at.
 *
 * ⚠️ **Choosing an episode stopped being a screen**. The header's button opens
 * this from anywhere; the episodes list keeps its own `Cortar` button for
 * people who arrive that way. Same
 * destination, two doors, one screen.
 *
 * ⚠️ **`/creator` is still a real route, and that is what makes this work.**
 * Browser-back closes the overlay because closing it IS going back; a link to
 * `/creator` opens it over the library rather than over a blank page; and the
 * URL of "I am choosing an episode" stays shareable. A boolean in a store would
 * have none of that.
 *
 * Three things the design called out, and all three are here:
 *
 *  1. **Focus is trapped while it is open** and returns to whatever opened it.
 *  2. **`Esc` closes it**, and so does the browser's back button.
 *  3. **It does not interrupt playback** — nothing here touches the player.
 *
 * ⚠️ The search is **title only**, because that is what the API does
 * (`GET /episodes?search=`, decided again on 2026-08-18 rather than widened).
 * The hint in the footer says so, which is what keeps it from reading as a
 * broken search when *gazpacho* finds nothing.
 */
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useEpisodeList } from '@/queries/episodes.query';
import { buildEpisodeUrl } from '@/utils/episode-url';
import { formatDateFull } from '@/utils/format-date';

const route = useRoute();
const router = useRouter();

const isOpen = computed(() => route.name === 'creatorSearch');

const search = ref('');
const highlighted = ref(0);
const field = ref<HTMLInputElement | null>(null);
const box = ref<HTMLElement | null>(null);
/** What had focus before this opened, so it can be given back. */
let opener: HTMLElement | null = null;

/**
 * ⚠️ Debounced by hand — 300 ms — rather than through `useListFilters`. This is
 * not a filtered LIST: its query must not touch the URL (the URL is `/creator`
 * and stays that way) and it has no page, no sort and no persisted limit. Using
 * the list composable here would put `?search=` in the address of an overlay.
 */
const debouncedSearch = ref('');
let timer: ReturnType<typeof setTimeout> | undefined;

watch(search, (value) => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    debouncedSearch.value = value;
    highlighted.value = 0;
  }, 300);
});

const episodes = useEpisodeList(() => ({
  search: debouncedSearch.value === '' ? undefined : debouncedSearch.value,
  // Eight fits the panel without scrolling; more would need a scrollbar inside
  // a list you drive with the arrow keys.
  limit: 8,
  page: 1,
}));

const results = computed(() => episodes.data.value?.results ?? []);

function close(): void {
  // ⚠️ `back()` when there is somewhere to go back TO, so the overlay leaves no
  // trace in the history; `replace` to the library for a cold entry on
  // `/creator`, which has nothing behind it.
  if (window.history.state?.back != null) router.back();
  else void router.replace({ name: 'home' }).catch(() => {});
}

function choose(index: number): void {
  const episode = results.value[index];
  if (episode === undefined) return;
  void router.replace({ name: 'creator', params: { title: buildEpisodeUrl(episode) } });
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    highlighted.value = Math.min(highlighted.value + 1, results.value.length - 1);
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    highlighted.value = Math.max(highlighted.value - 1, 0);
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    choose(highlighted.value);
    return;
  }

  // ⚠️ The focus trap. One field and a list of buttons, so a cycle is two
  // elements wide — `Tab` from the last goes to the first, and back again.
  if (event.key === 'Tab' && box.value !== null) {
    const focusable = box.value.querySelectorAll<HTMLElement>('input, button');
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

/**
 * ⚠️ `immediate`, and that is not tidiness: entering `/creator` COLD — a link
 * somebody shared, or a reload — mounts this component already open, and a
 * watcher without it never fires. The field would render focused-looking and
 * take no typing until the visitor clicked it.
 */
watch(
  isOpen,
  async (open) => {
    if (open) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      search.value = '';
      debouncedSearch.value = '';
      highlighted.value = 0;
      await nextTick();
      field.value?.focus();
      return;
    }
    // Focus goes back where it came from. Without this it lands on `<body>` and
    // the next Tab starts from the top of the page.
    opener?.focus();
    opener = null;
  },
  { immediate: true },
);
</script>

<template>
  <div
    v-if="isOpen"
    class="pal"
    role="dialog"
    aria-modal="true"
    aria-label="Elegir un episodio para cortar"
    @keydown="onKeydown"
    @click.self="close"
  >
    <div ref="box" class="pal__box">
      <label class="pal__field">
        <v-icon icon="mdi-magnify" size="18" aria-hidden="true" />
        <input
          ref="field"
          v-model="search"
          type="search"
          placeholder="Busca el episodio…"
          aria-label="Buscar episodio por título"
        />
        <span class="pal__kbd grav-mono">esc</span>
      </label>

      <div class="pal__list">
        <p v-if="episodes.isPending.value" class="pal__hint grav-mono">buscando…</p>

        <p v-else-if="results.length === 0" class="pal__hint">Ningún episodio se llama así.</p>

        <button
          v-for="(episode, index) of results"
          :key="episode.id"
          type="button"
          class="pal__item"
          :class="{ 'is-on': index === highlighted }"
          @mouseenter="highlighted = index"
          @click="choose(index)"
        >
          <span class="pal__cover" :style="{ backgroundImage: `url(${episode.cover})` }" />
          <span class="pal__text">
            <b>{{ episode.title }}</b>
            <span>
              {{ formatDateFull(episode.date) }} ·
              {{ episode.clipCount === 0 ? 'sin cortes' : `${episode.clipCount} cortes` }}
            </span>
          </span>
          <!-- ⚠️ Only on the highlighted row, as drawn. One red button follows
               the selection; six of them at once turn a list you drive with the
               arrow keys into a wall of calls to action. -->
          <span v-if="index === highlighted" class="pal__cut">
            <v-icon icon="mdi-content-cut" size="14" aria-hidden="true" />
            Cortar
          </span>
        </button>
      </div>

      <div class="pal__foot grav-mono">
        <span>↑↓ moverse</span><span>↵ cortar</span><span>esc cerrar</span>
        <span class="pal__foot-hint">busca solo en el título</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pal {
  position: fixed;
  inset: 0;
  z-index: 20;
  background: rgb(0 0 0 / 0.62);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 3rem 1rem;
}

.pal__box {
  width: min(560px, 100%);
  background: #242220;
  border: 1px solid rgb(220 192 142 / 0.3);
  border-radius: 8px;
  box-shadow: 0 26px 50px rgb(0 0 0 / 0.6);
  overflow: hidden;
}

.pal__field {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.8rem 0.9rem;
  border-bottom: 1px solid rgb(220 192 142 / 0.18);
  font-size: 1.05rem;
  color: var(--grav-stage-ink);
}

.pal__field .v-icon {
  color: var(--grav-brown);
  flex: 0 0 auto;
}

.pal__field input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 0;
  outline: none;
  color: var(--grav-stage-ink);
  font: inherit;
}

.pal__kbd {
  margin-left: auto;
  font-size: 0.68rem;
  color: var(--grav-stage-ink-faint);
  border: 1px solid rgb(220 192 142 / 0.25);
  border-radius: 4px;
  padding: 0.1rem 0.4rem;
}

.pal__list {
  max-height: 320px;
  overflow-y: auto;
}

.pal__item {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  gap: 0.7rem;
  align-items: center;
  width: 100%;
  padding: 0.5rem 0.9rem;
  border-bottom: 1px solid rgb(255 255 255 / 0.05);
  text-align: left;
  cursor: pointer;
}

.pal__item.is-on {
  background: rgba(var(--v-theme-primary), 0.3);
  box-shadow: inset 3px 0 0 rgb(var(--v-theme-primary));
}

.pal__cover {
  width: 42px;
  height: 42px;
  border-radius: 2px;
  background-color: var(--grav-stage-panel-deep);
  background-size: cover;
  background-position: center;
}

.pal__text {
  min-width: 0;
}

.pal__text b {
  display: block;
  font-family: var(--grav-font-title);
  font-weight: 400;
  text-transform: uppercase;
  font-size: 1.2rem;
  color: var(--grav-stage-ink);
  line-height: 1.05;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pal__text span {
  display: block;
  font-size: 0.74rem;
  color: var(--grav-stage-ink-muted);
}

.pal__cut {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.8rem;
  font-weight: 600;
  background: rgb(var(--v-theme-primary));
  color: var(--grav-stage-ink);
  border-radius: 3px;
  padding: 0.2rem 0.55rem;
  white-space: nowrap;
}

.pal__foot {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  padding: 0.5rem 0.9rem;
  font-size: 0.66rem;
  color: var(--grav-stage-ink-faint);
  background: var(--grav-stage-panel-deep);
}

.pal__foot-hint {
  margin-left: auto;
}

.pal__hint {
  padding: 1.5rem 0.9rem;
  text-align: center;
  font-size: 0.8rem;
  color: var(--grav-stage-ink-muted);
}

@media (max-width: 720px) {
  .pal {
    padding: 1rem 0.6rem;
  }

  .pal__cut {
    display: none;
  }
}
</style>
