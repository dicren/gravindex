<script setup lang="ts">
/**
 * The clip row — **the unit the whole site is made of**.
 *
 * ⚠️ **A row does not play, it queues.** That is the core decision: with a
 * global player carrying the queue, a play button on every row makes no sense —
 * there is one transport, at the bottom of the screen. The button here says `Cola`, and queueing into an EMPTY
 * queue starts playback immediately, or a first visit would begin in silence.
 *
 * Four screens render this: the library, an episode's clips, the permalink's
 * `Relacionados` and `Del mismo episodio`. That is why `episode` is a separate
 * prop — a clip inside `GET /episodes/:id` genuinely carries none, because the
 * screen showing it already is the episode.
 *
 * ⚠️ **The playing row is marked four ways at once**, because one of them is
 * colour: a tinted background, a 3 px inset rule, the title and icons in brown,
 * and a queue button that says `Reproduciendo` in words.
 *
 * ⚠️ **There is no `sonando ahora` line above the title any more** (2026-08-19).
 * It was the fourth mark before the button carried the state, and it was the one
 * thing in the row that changed its HEIGHT: the playing row stood 16 px taller
 * than the rest, so the whole list shifted every time a clip advanced. Reserving
 * the line on all 180 rows would have cost that height everywhere; the words now
 * live in the button, which was already the right place for them and does not
 * move. Do not put a badge back above the title.
 *
 * ⚠️ **The queue button has THREE states and is never absent** (2026-08-19). It
 * used to disappear on the playing row — correct in the abstract, since that
 * clip is already out of the queue, and wrong on screen: it took 8 rem out of
 * one row's action bar and slid every icon in it sideways, so the column of
 * share/download glyphs bent around whichever clip was sounding. It now says
 * `Reproduciendo` (or `En pausa`) instead, inert like `En la cola`, and **all
 * three states are exactly one width** — which is what keeps the bar identical
 * from row to row. That width is also why the label follows playback rather
 * than claiming `Reproduciendo` over a paused clip: there is room to be honest.
 *
 * ⚠️ **The action bar is a grid of FIXED tracks, not a flex row.** Vote,
 * duration, share, download and queue each own a track of a size that does not
 * depend on their contents, so a two-digit vote count, a longer duration or a
 * different button state cannot move the ones beside it. Rows line up in
 * columns; that is the whole point. **The two readings sit at its left edge and
 * the three controls at its right**, with a flexible spacer between them — the
 * numbers are text and belong with the text, the buttons are buttons.
 *
 * ⚠️ **The two icon actions carry a box, in brown** (2026-08-19). The mockup's
 * last round had stripped the box on the grounds that a bare glyph aligns with
 * the muted text beside it; against the real screen a bare glyph next to a
 * filled `Cola` button reads as decoration rather than as something you can
 * press. The box is 28 px inside a 46 px row, so it costs no height — which is
 * what the earlier round had been rejected for. ⚠️ And the ink is `brown`, not
 * `stageInkMuted`: at 17 px in the
 * muted grey, `mdi-link-variant` — three dots joined by two hairlines — is the
 * one glyph in the bar that disappears, which is exactly what was reported.
 */
import { computed } from 'vue';

import type { ClipRow } from '#/domain/clips/clip.entity';
import type { Episode } from '#/domain/episodes/episode.entity';
import type { Tag } from '#/domain/tags/tag.entity';
import { useClipActions } from '@/composables/use-clip-actions';
import { usePlaybackStore } from '@/stores/playback.store';
import { useQueueStore, type QueuedClip } from '@/stores/queue.store';
import { buildEpisodeUrl } from '@/utils/episode-url';
import { formatDate } from '@/utils/format-date';
import { formatClipTime } from '@/utils/format-time';

const props = withDefaults(
  defineProps<{
    clip: ClipRow;
    /** The episode this clip was cut from. ⚠️ Falls back to `clip.episode`,
     *  which every shape but `EpisodeClip` carries. */
    episode?: Episode;
    /** Hide the episode line on a screen that already names the episode above
     *  the list. */
    compact?: boolean;
    /** Heading level for the title. Pick it for the document outline. */
    headingLevel?: 2 | 3 | 4 | 5;
  }>(),
  { episode: undefined, compact: false, headingLevel: 3 },
);

const emit = defineEmits<{ 'select-tag': [tag: Tag] }>();

const playback = usePlaybackStore();
const queue = useQueueStore();
const actions = useClipActions();

const episode = computed(() => props.episode ?? props.clip.episode);
/**
 * ⚠️ **Two states, not one, and the difference is visible.** `isCurrent` is "the
 * clip the player is on" — which is what the row's whole highlight means, and
 * what makes its queue button inert, because it is already out of the queue.
 * `isPlaying` is narrower: it is what the word `Reproduciendo` claims, and a
 * paused clip must not claim it.
 */
const isCurrent = computed(() => playback.isCurrent(props.clip.id));
const isPlaying = computed(() => playback.isPlaying(props.clip.id));
const isQueued = computed(() => queue.contains(props.clip.id));

const duration = computed(() => Math.max(0, props.clip.end - props.clip.start));
const durationLabel = computed(() => formatClipTime(duration.value));

const permalink = computed(() => ({ name: 'clip' as const, params: { id: props.clip.id } }));

/**
 * The queue button's three states, in one place because they must stay one
 * button. ⚠️ Only the first one does anything — the other two report a state,
 * exactly as `En la cola` always has.
 *
 * ⚠️ `Añadir <título> a la cola` is the accessible name the e2e suite drives the
 * whole queue through; it is a public handle, not an implementation detail.
 */
const queueButton = computed(() => {
  if (isCurrent.value) {
    return isPlaying.value
      ? {
          text: 'Reproduciendo',
          icon: 'mdi-volume-high',
          label: `${props.clip.title} se está reproduciendo`,
        }
      : { text: 'En pausa', icon: 'mdi-pause', label: `${props.clip.title} está en pausa` };
  }
  if (isQueued.value) {
    return {
      text: 'En la cola',
      icon: 'mdi-check',
      label: `${props.clip.title} ya está en la cola`,
    };
  }
  return {
    text: 'Cola',
    icon: 'mdi-playlist-plus',
    label: `Añadir ${props.clip.title} a la cola`,
  };
});

function toQueuedClip(): QueuedClip | undefined {
  const source = episode.value;
  if (source === undefined) return undefined;

  return {
    kind: 'clip',
    id: props.clip.id,
    title: props.clip.title,
    start: props.clip.start,
    end: props.clip.end,
    // A clip has no audio file of its own: this is the EPISODE's remote mp3.
    src: source.file,
    episodeId: source.id,
    episodeTitle: source.title,
    cover: source.cover,
    up: props.clip.up,
  };
}

function enqueue(): void {
  const clip = toQueuedClip();
  if (clip !== undefined) actions.queue(clip);
}

function download(): void {
  const clip = toQueuedClip();
  if (clip !== undefined) void actions.download(clip);
}
</script>

<template>
  <article class="i-row" :class="{ 'is-playing': isCurrent }">
    <RouterLink class="i-row__cover-link" :to="permalink" tabindex="-1" aria-hidden="true">
      <span
        class="i-row__cover"
        :style="episode ? { backgroundImage: `url(${episode.cover})` } : undefined"
      />
    </RouterLink>

    <div class="i-row__main">
      <component :is="`h${props.headingLevel}`" class="i-row__title">
        <RouterLink class="i-row__title-link" :to="permalink">{{ props.clip.title }}</RouterLink>
      </component>

      <div class="i-row__meta">
        <RouterLink
          v-if="!props.compact && episode"
          class="i-row__episode"
          :to="{ name: 'episode', params: { title: buildEpisodeUrl(episode) } }"
        >
          {{ episode.title }}
        </RouterLink>
        <span v-if="!props.compact && episode" class="i-row__date">
          · {{ formatDate(episode.date) }}
        </span>

        <!-- ⚠️ Clicking a tag REPLACES the filter with that single tag. The
             screen decides what that means; the row only says which tag was
             pressed. -->
        <button
          v-for="tag of props.clip.tags"
          :key="tag"
          type="button"
          class="i-row__tag"
          :aria-label="`Filtrar por el tag ${tag}`"
          @click="emit('select-tag', tag)"
        >
          {{ tag }}
        </button>
      </div>
    </div>

    <div class="i-row__side">
      <button
        type="button"
        class="i-row__vote"
        :disabled="actions.voting.value"
        :aria-label="`Votar a favor de ${props.clip.title} (${props.clip.up} votos)`"
        @click="actions.vote(props.clip.id)"
      >
        <v-icon icon="mdi-thumb-up" size="13" aria-hidden="true" />
        <span class="i-row__count">{{ props.clip.up }}</span>
      </button>

      <span class="i-row__time">{{ durationLabel }}</span>

      <!-- ⚠️ Inert, and load-bearing: it holds the grid's spacer track open so
           the two readings stay left and the three controls stay right. -->
      <span class="i-row__gap" aria-hidden="true" />

      <button
        type="button"
        class="i-row__ico"
        :aria-label="`Compartir ${props.clip.title}`"
        @click="actions.share(props.clip.id)"
      >
        <v-icon icon="mdi-link-variant" size="17" aria-hidden="true" />
      </button>

      <button
        type="button"
        class="i-row__ico"
        :disabled="actions.isDownloading(props.clip.id)"
        :aria-label="
          actions.isDownloading(props.clip.id)
            ? `Descargando ${props.clip.title}…`
            : `Descargar ${props.clip.title}`
        "
        @click="download"
      >
        <v-icon
          icon="mdi-download"
          size="17"
          aria-hidden="true"
          :class="{ 'grav-pulse': actions.isDownloading(props.clip.id) }"
        />
      </button>

      <!-- ⚠️ Always here, in one of three states of one width. A button that
           vanishes on click loses the visitor's place, and a button that
           vanishes on the playing row drags the whole bar sideways with it. -->
      <button
        type="button"
        class="i-row__queue"
        :class="{ 'is-queued': isQueued && !isCurrent, 'is-current': isCurrent }"
        :disabled="isCurrent || isQueued"
        :aria-label="queueButton.label"
        @click="enqueue"
      >
        <v-icon :icon="queueButton.icon" size="14" aria-hidden="true" />
        {{ queueButton.text }}
      </button>
    </div>
  </article>
</template>

<style scoped>
.i-row {
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr) auto;
  gap: 0.9rem;
  align-items: center;
  padding: 0.62rem 0.5rem;
  border-bottom: 1px solid var(--grav-hairline);
}

.i-row.is-playing {
  background: rgba(var(--v-theme-primary), 0.25);
  box-shadow: inset 3px 0 0 rgb(var(--v-theme-primary));
}

.i-row__cover-link {
  display: block;
  line-height: 0;
}

.i-row__cover {
  display: block;
  width: 46px;
  height: 46px;
  border-radius: 2px;
  background-color: var(--grav-stage-panel);
  background-size: cover;
  background-position: center;
}

.i-row__main {
  min-width: 0;
}

.i-row__title {
  font-family: var(--grav-font-title);
  font-weight: 400;
  text-transform: uppercase;
  font-size: 1.68rem;
  line-height: 1;
  margin: 0 0 0.15rem;
  overflow-wrap: anywhere;
}

.i-row__title-link {
  color: var(--grav-stage-ink);
  text-decoration: none;
  text-shadow: var(--grav-title-shadow);
}

.i-row.is-playing .i-row__title-link {
  color: var(--grav-brown);
}

.i-row__meta {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
  font-size: 0.78rem;
  color: var(--grav-stage-ink-muted);
}

/* ⚠️ The episode link is the ONE prose link on the stage that must not take the
   brightened red from `gravinero.css` — a row already has a red thing in it
   (the queue button) and two would fight. */
.i-row__episode {
  color: inherit;
  text-decoration: none;
}

.i-row__episode:hover,
.i-row__episode:focus-visible {
  color: var(--grav-brown);
}

.i-row__date {
  margin-left: -0.3rem;
}

.i-row__tag {
  font-size: 0.7rem;
  padding: 0.05rem 0.4rem;
  border: 1px solid rgb(220 192 142 / 0.32);
  border-radius: 2px;
  color: var(--grav-brown);
  white-space: nowrap;
  cursor: pointer;
}

.i-row__tag:hover,
.i-row__tag:focus-visible {
  border-color: var(--grav-brown);
}

/*
 * ⚠️ **Fixed tracks, so every row's actions land on the same columns.** As a
 * flex row this bar was laid out by its contents: a three-digit vote count, a
 * longer duration or a wider queue label pushed everything beside it, and the
 * playing row — which had no queue button at all — pulled its two icons a
 * whole button's width to the right. Each track is sized for its widest
 * possible content and nothing here may go back to `auto`.
 */
.i-row__side {
  display: grid;
  /* ⚠️ The third track is the SPACER, and it is why `.i-row__gap` exists in the
     markup: grid auto-placement fills tracks in source order, so six tracks
     need six children or the share button lands in the gap. `minmax(2rem, 1fr)`
     is deliberate at both ends — a hair on the shrink-to-fit desktop bar, where
     every pixel taken from the title wraps somebody's meta line, and the whole
     slack on a phone, where the bar spans the row. With the 0.5 rem gaps either
     side of it that is 24 px between the readings and the controls against
     8 px inside each group, which is what makes them read as two. */
  grid-template-columns: 2.4rem 2.3rem minmax(0.5rem, 1fr) 28px 28px 7.9rem;
  align-items: center;
  gap: 0.5rem;
}

.i-row__vote {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  /* The thumb pins to the left of its track and the count grows to the right,
     so the icon is on the same x in every row whatever the number says. */
  justify-self: start;
  font-size: 0.78rem;
  color: rgb(var(--v-theme-success));
  cursor: pointer;
}

.i-row__vote:disabled {
  cursor: default;
  opacity: 0.6;
}

.i-row__count {
  font-variant-numeric: tabular-nums;
}

.i-row__time {
  font-family: var(--grav-font-mono);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  /* ⚠️ Left-aligned with the vote beside it, and `nowrap`: `mm:ss` covers every
     clip in the database (the longest is 26:45) and the rare `hh:mm:ss`
     overflows its track without pushing anything, which is the failure mode
     worth having. */
  justify-self: start;
  white-space: nowrap;
  color: var(--grav-stage-ink-muted);
}

/* ⚠️ A box in brown, by decision — see the component note. 28 px inside a 46 px
   row, so it adds no height; the same hairline and the same ink as a tag chip,
   so the row has one outlined-control language rather than two. */
.i-row__ico {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--grav-hairline-strong);
  border-radius: 4px;
  background: rgb(255 255 255 / 0.05);
  color: var(--grav-brown);
  cursor: pointer;
}

.i-row__ico:hover,
.i-row__ico:focus-visible {
  border-color: var(--grav-brown);
  background: rgb(220 192 142 / 0.14);
}

.i-row.is-playing .i-row__vote {
  color: var(--grav-brown);
}

.i-row.is-playing .i-row__ico {
  border-color: rgb(220 192 142 / 0.5);
}

/* The only red thing in a row, because it is the only thing that changes
   state. ⚠️ **One width for all three states** — `Reproduciendo` is the widest
   label there is, and the box is sized for it so that nothing in the bar moves
   when a clip starts, is queued, or is paused. The border is declared on every
   state, transparent on the red one, or the two outlined states would be 2 px
   narrower than the filled one. */
.i-row__queue {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  /* Measured: `Reproduciendo` with its icon needs 125 px. */
  width: 7.9rem;
  font-size: 0.8rem;
  font-weight: 600;
  background: rgb(var(--v-theme-primary));
  border: 1px solid transparent;
  color: var(--grav-stage-ink);
  border-radius: 3px;
  padding: 0.2rem 0.55rem;
  white-space: nowrap;
  cursor: pointer;
}

.i-row__queue.is-queued {
  background: transparent;
  border-color: var(--grav-hairline-strong);
  color: var(--grav-stage-ink-muted);
  cursor: default;
}

/* The playing row's own state, in the brown everything else of its is. */
.i-row__queue.is-current {
  background: transparent;
  border-color: rgb(220 192 142 / 0.5);
  color: var(--grav-brown);
  cursor: default;
}

/* ⚠️ 720 px, the breakpoint the whole design uses. The side actions drop to
   their own line rather than shrinking — at 390 px they do not fit beside a
   title, and a row with two heights is what the boxed icons were rejected
   for. */
@media (max-width: 720px) {
  .i-row {
    grid-template-columns: 44px minmax(0, 1fr);
    row-gap: 0.5rem;
  }

  .i-row__title {
    font-size: 1.36rem;
  }

  /* Full width, and the spacer does the separating — the same two groups as on
     a desktop, only further apart. */
  .i-row__side {
    grid-column: 1 / -1;
    width: auto;
  }
}
</style>
