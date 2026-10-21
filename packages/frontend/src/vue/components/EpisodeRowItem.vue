<script setup lang="ts">
/**
 * An episode row.
 *
 * ⚠️ **`Cortar` is the primary action.** Only 61 of the 395 episodes
 * have ever had a clip cut from them, so this screen's job is to make that
 * visible and offer the thing that fixes it. `Ver los cortes` appears only when
 * there are any.
 *
 * The cover is 64 px here against the clip row's 46: an episode is a bigger
 * thing than a cut of it, and the row has one less line of meta to balance.
 */
import { computed } from 'vue';

import type { EpisodeListItem } from '#/domain/episodes/episode.entity';
import { useMomentsStore } from '@/stores/moments.store';
import { buildEpisodeUrl } from '@/utils/episode-url';
import { formatDateFull } from '@/utils/format-date';

const props = defineProps<{ episode: EpisodeListItem }>();

const moments = useMomentsStore();

const slug = computed(() => buildEpisodeUrl(props.episode));
const hasClips = computed(() => props.episode.clipCount > 0);

/**
 * `2 momentos` — the marks this visitor left on this episode (2026-08-26).
 *
 * ⚠️ **On every episode row, not only under the `Con mis momentos` filter.** It
 * is what makes the filter's result recognisable rather than mysterious, and in
 * the full list it is the only sign that says "you have been here". It costs no
 * request: the marks are already in the browser.
 *
 * ⚠️ **Absent at zero**, like `Ver los cortes`. A `0 momentos` on all 589 rows
 * would advertise a feature to somebody who has not used it, on every row of a
 * list that is about the podcast.
 */
const momentCount = computed(() => moments.countFor(props.episode.id));
const momentLabel = computed(() =>
  momentCount.value === 1 ? '1 momento tuyo' : `${momentCount.value} momentos tuyos`,
);

/** `7 cortes`, `1 corte`, `sin cortes`. ⚠️ The singular is not pedantry — 24 of
 *  the 61 episodes that have clips have exactly one. */
const countLabel = computed(() => {
  const count = props.episode.clipCount;
  if (count === 0) return 'sin cortes';
  return count === 1 ? '1 corte' : `${count} cortes`;
});
</script>

<template>
  <article class="ep-row">
    <RouterLink
      class="ep-row__cover-link"
      :to="{ name: 'episode', params: { title: slug } }"
      tabindex="-1"
      aria-hidden="true"
    >
      <span class="ep-row__cover" :style="{ backgroundImage: `url(${props.episode.cover})` }" />
    </RouterLink>

    <div class="ep-row__main">
      <h3 class="ep-row__title">
        <RouterLink class="ep-row__title-link" :to="{ name: 'episode', params: { title: slug } }">
          {{ props.episode.title }}
        </RouterLink>
      </h3>

      <div class="ep-row__meta">
        {{ formatDateFull(props.episode.date) }}
        <span class="ep-row__count" :class="{ 'is-empty': !hasClips }">{{ countLabel }}</span>
        <span v-if="momentCount > 0" class="ep-row__count ep-row__mine" data-test="row-moments">
          {{ momentLabel }}
        </span>
      </div>
    </div>

    <div class="ep-row__side">
      <RouterLink
        v-if="hasClips"
        class="ep-row__ghost"
        :to="{ name: 'episode', params: { title: slug } }"
      >
        Ver los cortes
      </RouterLink>

      <RouterLink class="ep-row__cut" :to="{ name: 'creator', params: { title: slug } }">
        <v-icon icon="mdi-content-cut" size="14" aria-hidden="true" />
        Cortar
      </RouterLink>
    </div>
  </article>
</template>

<style scoped>
.ep-row {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) auto;
  gap: 0.9rem;
  align-items: center;
  padding: 0.62rem 0.5rem;
  border-bottom: 1px solid var(--grav-hairline);
}

.ep-row__cover-link {
  display: block;
  line-height: 0;
}

.ep-row__cover {
  display: block;
  width: 64px;
  height: 64px;
  border-radius: 2px;
  background-color: var(--grav-stage-panel);
  background-size: cover;
  background-position: center;
}

.ep-row__main {
  min-width: 0;
}

.ep-row__title {
  font-family: var(--grav-font-title);
  font-weight: 400;
  text-transform: uppercase;
  font-size: 1.55rem;
  line-height: 1;
  margin: 0 0 0.18rem;
  overflow-wrap: anywhere;
}

.ep-row__title-link {
  color: var(--grav-stage-ink);
  text-decoration: none;
  text-shadow: var(--grav-title-shadow);
}

.ep-row__meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  font-size: 0.78rem;
  color: var(--grav-stage-ink-muted);
}

/* ⚠️ Filled rather than outlined, which is the difference between "what the
   site has" and "what you have". Same shape, same size: it is a count beside a
   count, not a badge shouting over one. */
.ep-row__mine {
  background: rgb(220 192 142 / 0.14);
  border-color: var(--grav-hairline-strong);
}

.ep-row__count {
  font-family: var(--grav-font-mono);
  font-size: 0.7rem;
  font-variant-numeric: tabular-nums;
  color: var(--grav-brown);
  border: 1px solid rgb(220 192 142 / 0.32);
  border-radius: 20px;
  padding: 0.05rem 0.5rem;
}

/* Dimmer, not hidden: "sin cortes" is the fact this screen exists to show. */
.ep-row__count.is-empty {
  color: var(--grav-stage-ink-faint);
  border-color: rgb(220 192 142 / 0.16);
}

.ep-row__side {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.ep-row__ghost {
  font-size: 0.82rem;
  color: var(--grav-stage-ink-muted);
  text-decoration: none;
  border-bottom: 1px solid var(--grav-hairline-strong);
  white-space: nowrap;
}

.ep-row__ghost:hover,
.ep-row__ghost:focus-visible {
  color: var(--grav-brown);
}

.ep-row__cut {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8rem;
  font-weight: 600;
  background: rgb(var(--v-theme-primary));
  color: var(--grav-stage-ink);
  border-radius: 3px;
  padding: 0.2rem 0.55rem;
  text-decoration: none;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .ep-row {
    grid-template-columns: 56px minmax(0, 1fr);
    row-gap: 0.5rem;
  }

  .ep-row__side {
    grid-column: 1 / -1;
    justify-content: space-between;
  }
}

/*
 * ⚠️ The same narrow layout, asked of the CONTAINER instead of the window, and
 * the duplication is deliberate.
 *
 * The calendar's day panel is a 23 rem popover that can sit on a 1400 px
 * desktop, where the media query above says "wide" and this row would try to fit
 * a cover, a title and two actions on one line — leaving the title about ten
 * characters. The panel declares `container-type: inline-size`; every other
 * caller declares no container at all, so this block simply never applies there
 * and the media query keeps doing the work.
 *
 * ⚠️ It cannot be merged with the rule above: `@media` and `@container` are
 * different at-rules and neither nests the other's condition. Change the two
 * together.
 */
@container (max-width: 720px) {
  .ep-row {
    grid-template-columns: 56px minmax(0, 1fr);
    row-gap: 0.5rem;
  }

  .ep-row__side {
    grid-column: 1 / -1;
    justify-content: space-between;
  }
}
</style>
