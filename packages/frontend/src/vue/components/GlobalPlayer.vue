<script setup lang="ts">
/**
 * The global player: fixed to the bottom, carrying the queue.
 *
 * ⚠️ **It is the reason rows have no play button.** With one transport for the
 * whole site, a card that played would be a second one; a card queues instead
 * and this is where anything is ever heard.
 *
 * ⚠️ **It renders even with nothing playing**, saying `Nada sonando`. A player
 * that appears and disappears would reflow every list under it and move the
 * queue pill — which is also the link to `/cola` — out from under the cursor.
 *
 * Left to right: play/pause · next · title and `Nº id · Episodio` · waveform ·
 * `mm:ss / mm:ss` · vote, share, download · the queue pill · the caricatures.
 * Below 720 px the waveform, the time and the caricatures go and the title takes
 * the space — the design's own rule.
 *
 * ⚠️ **The rule along its top edge is the progress bar BELOW 720 px, and only
 * there** (draggable since 2026-08-19; narrowed to the phone on 2026-08-22). It
 * used to be a static `border-top` everywhere. On a phone the waveform is gone,
 * so the rule becomes a track, a fill and a handle, and is the only place the
 * position is either drawn or changed. On a wide screen the waveform already
 * draws the position AND seeks on a click, so the rule would be a second
 * control saying the same thing: it stays the plain brown line it always was —
 * no fill, no handle, nothing to drag, one less `Tab` stop.
 *
 * ⚠️ **The band is a photograph, so the ground behind it shows through.** It is
 * `playerGround` (`#6d1409`) plus `pollitos-band.jpg` repeated on X plus a 45 %
 * black scrim, in that order; drop the ground and the white between the birds
 * turns the strip into a light band under a dark site.
 *
 * ⚠️ While the EDITOR is open this shows `En pausa · el editor manda mientras
 * cortas`. That is not a special case built here — the editor owns its own
 * audio element and asks the playback store to stop on the way in
 * (`utils/editor-audio.ts`), so the player simply has nothing loaded.
 */
import { computed, ref } from 'vue';
import { useQuery } from '@pinia/colada';

import type { EpisodeWaveform } from '#/domain/episodes/episode.entity';
import type { DomainError } from '#/domain/errors';
import { useClipActions } from '@/composables/use-clip-actions';
import { useMomentActions } from '@/composables/use-moment-actions';
import { episodeWaveformQueryOptions } from '@/queries/episodes.query';
import { usePlaybackStore } from '@/stores/playback.store';
import { useMomentsStore } from '@/stores/moments.store';
import { useQueueStore } from '@/stores/queue.store';
import { buildEpisodeUrl } from '@/utils/episode-url';
import { formatClipTime } from '@/utils/format-time';
import GravWave from './GravWave.vue';

/** ⚠️ Relative, not aliased: `@` is `src/vue`, and the images live in
 *  `src/assets/`. */
import mascotUrl from '../../assets/gravina82-header.png';
import bandUrl from '../../assets/pollitos-band.jpg';

const playback = usePlaybackStore();
const queue = useQueueStore();
const actions = useClipActions();
const momentActions = useMomentActions();
const moments = useMomentsStore();

/**
 * What is loaded, and the two narrowings every branch below uses.
 *
 * ⚠️ **A whole episode can be here since 2026-08-25** (`QueuedEpisode`), and
 * the difference is not cosmetic: an episode has no vote, no download and no
 * `Nº`, and its share link is `/episode/<id>-<slug>` rather than `/<id>`. The
 * two computeds are how the template says which one it is drawing without ever
 * reaching for a property the other shape does not have.
 */
const item = computed(() => queue.current);
const clip = computed(() => (item.value?.kind === 'clip' ? item.value : null));
const episode = computed(() => (item.value?.kind === 'episode' ? item.value : null));
const hasItem = computed(() => item.value !== null && playback.current !== null);

/** Bars in the mockups, and what `GravWave`'s own placeholder defaults to —
 *  keeping the two in step means switching from measured to placeholder (an
 *  episode with no waveform yet) never changes the bar count mid-render. */
const WAVEFORM_POINTS = 128;

/**
 * ⚠️ `useQuery` over the options factory rather than a ready-made composable,
 * for `enabled`: with nothing queued there is no episode to ask for, and a
 * request must not fire just because the player is idle.
 */
/**
 * Which episode's waveform to ask for, and for which window.
 *
 * ⚠️ **A whole episode asks for no window at all** — `GET /episodes/:id/waveform`
 * with neither `from` nor `to` is the whole file, which is exactly what the bar
 * has to draw. A clip keeps asking for its own slice, so the two never share a
 * cache entry even when they are the same episode.
 */
const waveformRequest = computed(() => {
  const cut = clip.value;
  if (cut !== null) {
    return { episodeId: cut.episodeId, query: { from: cut.start, to: cut.end } };
  }
  const whole = episode.value;
  return whole === null ? null : { episodeId: whole.id, query: {} };
});

const { data: waveform } = useQuery<EpisodeWaveform, DomainError>(() => ({
  ...episodeWaveformQueryOptions(waveformRequest.value?.episodeId ?? 0, {
    ...waveformRequest.value?.query,
    points: WAVEFORM_POINTS,
  }),
  enabled: waveformRequest.value !== null,
}));

const peaks = computed(() => waveform.value?.peaks);

const elapsedLabel = computed(() => formatClipTime(playback.elapsed));
const durationLabel = computed(() => formatClipTime(playback.duration));
const progress = computed(() =>
  playback.duration <= 0 ? 0 : playback.elapsed / playback.duration,
);

/**
 * The seek bar's resolution. A range input needs integers, and a clip's own
 * `duration` is not known until the stream reports it — so the control counts
 * thousandths of the clip and the store turns that back into seconds.
 */
const SEEK_STEPS = 1000;

/**
 * The value the handle is being dragged to, or `null` when nobody is dragging.
 *
 * ⚠️ **Without this the handle stutters under the finger.** The input's value is
 * bound to `progress`, which comes back from the audio element; a `timeupdate`
 * that was already in flight when the seek landed reports the OLD position and
 * yanks the handle backwards for a frame. While a drag is happening the input
 * owns the number, and the store catches up.
 */
const scrubbing = ref<number | null>(null);

const seekValue = computed(() => scrubbing.value ?? Math.round(progress.value * SEEK_STEPS));

function onScrub(event: Event): void {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;

  const steps = Number(input.value);
  scrubbing.value = steps;
  playback.seekToFraction(steps / SEEK_STEPS);
}

function endScrub(): void {
  scrubbing.value = null;
}

/** `5 en cola` / `1 en cola`. Counts `upcoming`, not the whole queue — what
 *  has already played should not inflate a number that is supposed to say
 *  what is left to hear. The pill is also the link to `/cola`. */
const queueLabel = computed(() => `${queue.upcoming.length} en cola`);

/**
 * `Marcar este momento` — **the whole feature's one button** (2026-08-26).
 *
 * ⚠️ **It lives here because this is where the sound is.** An episode plays
 * through this player as a queue item, so it keeps sounding while the visitor
 * walks off to the library or to a clip; a button that only existed on
 * `/episode/:id` would be missing at exactly the moment somebody wants it. The
 * episode's own transport carries the same button as a second entrance, not as
 * the only one.
 *
 * ⚠️ **Only for an episode.** Marking a moment inside a clip is not a smaller
 * version of this, it is a different thing — a clip already IS the moment, and
 * it has a permalink to say so. Same rule as vote and download, which are
 * absent rather than disabled when an episode is what is playing.
 */
function markMoment(): void {
  const whole = episode.value;
  if (whole === null) return;
  momentActions.mark(whole.id, playback.elapsed);
}

/** How many marks this episode already carries. ⚠️ Spoken, not drawn: the pill
 *  is the same 28 px as the two beside it and a badge on it would be the one
 *  number on this bar nobody asked for. */
const momentCountLabel = computed(() => {
  const whole = episode.value;
  if (whole === null) return '';
  const count = moments.countFor(whole.id);
  if (count === 0) return 'Marcar este momento';
  return count === 1
    ? 'Marcar este momento (ya tienes 1 en este episodio)'
    : `Marcar este momento (ya tienes ${count} en este episodio)`;
});

/** Click-to-seek over the waveform. `getBoundingClientRect` rather than
 *  `offsetX` so a click landing on an inner `<rect>` still measures against the
 *  whole bar. */
function seek(event: MouseEvent): void {
  if (!hasItem.value) return;
  const bar = event.currentTarget;
  if (!(bar instanceof HTMLElement)) return;
  const { left, width } = bar.getBoundingClientRect();
  if (width === 0) return;
  playback.seekToFraction((event.clientX - left) / width);
}
</script>

<template>
  <!-- ⚠️ **Two boxes, and the split is load-bearing.** `.player` clips its own
       overflow (the caricatures bleed off the right edge), so anything drawn on
       its top line loses whatever pokes above it — which is half the seek
       handle. The dock is the fixed shell and clips nothing; the band clips
       inside it, and the progress bar is the band's SIBLING, laid over its top
       three pixels. -->
  <div class="player-dock">
    <div class="player" :style="{ backgroundImage: `url(${bandUrl})` }">
      <div class="player__scrim" aria-hidden="true" />

      <button
        type="button"
        class="player__play"
        :disabled="queue.isEmpty && !hasItem"
        :aria-label="playback.playing ? 'Pausar' : 'Reproducir'"
        @click="queue.togglePlayback()"
      >
        <v-icon :icon="playback.playing ? 'mdi-pause' : 'mdi-play'" size="22" aria-hidden="true" />
      </button>

      <button
        type="button"
        class="player__next"
        :disabled="!queue.hasNext"
        aria-label="Siguiente corte de la cola"
        @click="queue.next()"
      >
        <v-icon icon="mdi-skip-next" size="17" aria-hidden="true" />
      </button>

      <div class="player__meta">
        <template v-if="clip">
          <RouterLink class="player__title" :to="{ name: 'clip', params: { id: clip.id } }">
            {{ clip.title }}
          </RouterLink>
          <span class="player__sub grav-mono">Nº {{ clip.id }} · {{ clip.episodeTitle }}</span>
        </template>
        <!-- ⚠️ `Episodio completo` rather than a `Nº`: an episode's number is
             in its own title (`Episodio 58`), and the id that addresses it is
             not the number anybody knows it by — episode 93 IS "Episodio 58". -->
        <template v-else-if="episode">
          <RouterLink
            class="player__title"
            :to="{ name: 'episode', params: { title: buildEpisodeUrl(episode) } }"
          >
            {{ episode.title }}
          </RouterLink>
          <span class="player__sub grav-mono">Episodio completo</span>
        </template>
        <template v-else>
          <span class="player__title player__title--idle">Nada sonando</span>
          <span class="player__sub grav-mono">
            {{ queue.isEmpty ? 'añade cortes a la cola' : 'pulsa play para empezar la cola' }}
          </span>
        </template>
      </div>

      <!-- ⚠️ A `<button>`, not a bare `<span>` with a click handler: it is a
         control, and an anchor without `href` cannot be reached from a keyboard. -->
      <button
        v-if="hasItem && item"
        type="button"
        class="player__wave"
        :aria-label="`Buscar dentro de ${item.title}`"
        @click="seek"
      >
        <GravWave :progress="progress" :seed="item.id" :peaks="peaks" />
      </button>
      <span v-else class="player__wave player__wave--idle" aria-hidden="true">
        <GravWave :progress="0" :seed="0" />
      </span>

      <span class="player__time grav-mono">{{ elapsedLabel }} / {{ durationLabel }}</span>

      <div class="player__actions">
        <button
          v-if="clip"
          type="button"
          class="player__pill"
          :disabled="actions.voting.value"
          :aria-label="`Votar a favor (${clip.up} votos)`"
          @click="actions.vote(clip.id)"
        >
          <v-icon icon="mdi-thumb-up" size="14" aria-hidden="true" />
          {{ clip.up }}
        </button>

        <!-- ⚠️ 17 px where the vote's thumb is 14: `mdi-link-variant` is three
           dots joined by two hairlines, and at the size the others are legible
           at it reads as a smudge. Same reason as the row's icons. -->
        <button
          v-if="clip"
          type="button"
          class="player__pill"
          aria-label="Compartir este corte"
          @click="actions.share(clip.id)"
        >
          <v-icon icon="mdi-link-variant" size="17" aria-hidden="true" />
        </button>

        <!-- ⚠️ **An episode's own action, and the only one it has that a clip
             does not** (2026-08-26). It sits FIRST, where the vote sits for a
             clip: that x is the one the thumb already knows, and marking is to
             an episode what voting is to a cut — the thing you press without
             looking. See `markMoment` for why it is not offered on a clip. -->
        <button
          v-if="episode"
          type="button"
          class="player__pill"
          :aria-label="momentCountLabel"
          :title="momentCountLabel"
          data-test="mark-moment"
          @click="markMoment"
        >
          <v-icon icon="mdi-star-plus-outline" size="17" aria-hidden="true" />
        </button>

        <!-- ⚠️ The other action an episode keeps. Vote and download are absent
             rather than disabled: neither exists for an episode — there is no
             `POST /episodes/:id/vote`, and a download of three hours is not the
             feature the download button offers. -->
        <button
          v-if="episode"
          type="button"
          class="player__pill"
          aria-label="Compartir este episodio"
          @click="actions.shareEpisode(episode)"
        >
          <v-icon icon="mdi-link-variant" size="17" aria-hidden="true" />
        </button>

        <button
          v-if="clip"
          type="button"
          class="player__pill"
          :disabled="actions.isDownloading(clip.id)"
          :aria-label="actions.isDownloading(clip.id) ? 'Descargando…' : 'Descargar este corte'"
          @click="actions.download(clip)"
        >
          <v-icon
            icon="mdi-download"
            size="17"
            aria-hidden="true"
            :class="{ 'grav-pulse': actions.isDownloading(clip.id) }"
          />
        </button>
      </div>

      <RouterLink class="player__queue" :to="{ name: 'queue' }">
        <v-icon icon="mdi-playlist-music" size="15" aria-hidden="true" />
        {{ queueLabel }}
      </RouterLink>

      <span
        class="player__mascot"
        :style="{ backgroundImage: `url(${mascotUrl})` }"
        aria-hidden="true"
      />
    </div>

    <!-- ⚠️ **The line that separates the player from the site IS the progress
         bar — on a phone.** It was a plain 3 px brown border until 2026-08-19;
         below 720 px the strip was already there, already the full width and
         already the one horizontal rule the eye follows, so drawing the
         position anywhere else would have been a second line saying the same
         thing. The track keeps the border's job when nothing is playing.

         ⚠️ **Above 720 px the fill and the handle are `display: none` and the
         rule is just a rule** (2026-08-22). The waveform beside it already
         draws the position and seeks on a click; two controls for one number is
         one to explain and one extra `Tab` stop. It is CSS rather than
         `useCompactLayout` on purpose: `display: none` takes the input out of
         the tab order and the accessibility tree just as well, and this way
         nothing here depends on `matchMedia`.

         ⚠️ **The handle is a native `<input type="range">`, not a `v-slider`.**
         A 3 px rule that has to sit flush with the top edge of a 78 px band is
         not a shape Vuetify's slider takes without fighting its own wrapper,
         its density and its layered CSS; the input needs `appearance: none`,
         two vendor pseudo-elements and nothing else, and it brings arrow-key
         seeking with it for free.

         ⚠️ It lives OUT here, beside the band rather than inside it, so the
         handle can be centred on the rule: `.player` clips its overflow and
         would cut the top half off. -->
    <div class="player__progress">
      <span class="player__progress-fill" :style="{ transform: `scaleX(${progress})` }" />
      <input
        class="player__seek"
        type="range"
        min="0"
        :max="SEEK_STEPS"
        step="1"
        :value="seekValue"
        :disabled="!hasItem"
        aria-label="Posición de la reproducción"
        :aria-valuetext="`${elapsedLabel} de ${durationLabel}`"
        @input="onScrub"
        @change="endScrub"
        @pointerup="endScrub"
        @blur="endScrub"
      />
    </div>
  </div>
</template>

<style scoped>
/* The fixed shell. ⚠️ It clips NOTHING — that is its whole job. */
.player-dock {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 4;
  height: 78px;
}

.player {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  gap: 0.8rem;
  padding: 0 0.9rem;
  background-color: var(--grav-player-ground);
  background-repeat: repeat-x;
  background-size: auto 100%;
  overflow: hidden;
}

/* Below 720 px the rule along the top edge is this bar, laid over the band's
   top three pixels. ⚠️ Last in the DOM so the handle paints above everything in it. */
.player__progress {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  z-index: 1;
  background: var(--grav-brown);
}

/* ⚠️ Both off above 720 px, where the waveform is the seek control. The media
   query at the bottom of this file turns them on. */
.player__progress-fill,
.player__seek {
  display: none;
}

.player__progress-fill {
  height: 100%;
  background: var(--grav-brown);
  /* ⚠️ `scaleX` rather than `width`: this repaints four times a second while a
     clip plays, and a transform is the one property that costs nothing. */
  transform-origin: left center;
}

/* The handle. ⚠️ 16 px of grab area CENTRED on the 3 px rule, which is only
   possible because this element is not inside the band — see the note on the
   markup. The dot therefore straddles the line rather than hanging from it. */
.player__seek {
  /* ⚠️ Both sizes live here so the WebKit offset below can be derived from
     them rather than copied. Custom properties inherit into the slider's
     pseudo-elements, which is what makes that possible. */
  --seek-grab: 16px;
  --seek-dot: 10px;

  position: absolute;
  top: 50%;
  left: 0;
  width: 100%;
  height: var(--seek-grab);
  margin: 0;
  padding: 0;
  transform: translateY(-50%);
  appearance: none;
  background: transparent;
  cursor: pointer;
}

.player__seek::-webkit-slider-runnable-track {
  height: var(--seek-grab);
  background: transparent;
}

/* ⚠️ **`margin-top` is what centres the dot, and it is not optional.** WebKit
   lays the thumb against the TOP of the runnable track, not its middle, so
   without it the dot sits `(grab - dot) / 2` too high — 3 px here, which on a
   3 px rule is the whole bar and is exactly how it was reported. Derived rather
   than written out, so changing either size cannot leave it stale. ⚠️ Firefox
   centres `::-moz-range-thumb` itself and must NOT get the same offset. */
.player__seek::-webkit-slider-thumb {
  appearance: none;
  width: var(--seek-dot);
  height: var(--seek-dot);
  margin-top: calc((var(--seek-grab) - var(--seek-dot)) / 2);
  border-radius: 50%;
  background: var(--grav-brown);
  border: 1px solid var(--grav-on-brown);
  cursor: grab;
}

.player__seek::-moz-range-track {
  height: var(--seek-grab);
  background: transparent;
}

.player__seek::-moz-range-thumb {
  width: var(--seek-dot);
  height: var(--seek-dot);
  border-radius: 50%;
  background: var(--grav-brown);
  border: 1px solid var(--grav-on-brown);
  cursor: grab;
}

/* Nothing loaded: the rule is a rule again, and there is nothing to drag. */
.player__seek:disabled {
  cursor: default;
}

.player__seek:disabled::-webkit-slider-thumb {
  opacity: 0;
}

.player__seek:disabled::-moz-range-thumb {
  opacity: 0;
}

.player__seek:focus-visible::-webkit-slider-thumb {
  outline: 2px solid var(--grav-stage-ink);
  outline-offset: 1px;
}

.player__seek:focus-visible::-moz-range-thumb {
  outline: 2px solid var(--grav-stage-ink);
  outline-offset: 1px;
}

/* ⚠️ The band is a photograph with white between the birds; without the scrim
   the brown text on it is unreadable in patches and only in patches, which is
   the worst kind of contrast bug to find. */
.player__scrim {
  position: absolute;
  inset: 0;
  background: rgb(0 0 0 / 0.45);
}

.player > *:not(.player__scrim) {
  position: relative;
}

.player__play {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: var(--grav-brown);
  color: var(--grav-on-brown);
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  cursor: pointer;
}

.player__next {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 2px solid rgb(220 192 142 / 0.55);
  color: var(--grav-brown);
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  cursor: pointer;
}

.player__play:disabled,
.player__next:disabled {
  opacity: 0.45;
  cursor: default;
}

.player__meta {
  min-width: 110px;
  max-width: 230px;
}

.player__title {
  display: block;
  font-family: var(--grav-font-title);
  font-size: 1.4rem;
  text-transform: uppercase;
  font-weight: 400;
  color: var(--grav-stage-ink);
  text-shadow: var(--grav-title-shadow);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-decoration: none;
}

.player__title--idle {
  color: rgb(255 255 255 / 0.75);
}

.player__sub {
  display: block;
  font-size: 0.68rem;
  color: var(--grav-brown);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.player__wave {
  flex: 1;
  height: 38px;
  min-width: 50px;
  cursor: pointer;
  --grav-wave-idle: rgb(220 192 142 / 0.32);
  --grav-wave-played: var(--grav-brown);
}

.player__wave--idle {
  cursor: default;
  opacity: 0.5;
}

.player__time {
  font-size: 0.75rem;
  color: var(--grav-brown);
  white-space: nowrap;
}

.player__actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex: 0 0 auto;
}

/* ⚠️ The three are the SAME pill — vote, share and download — and the design
   says so explicitly. A vote button that looked different from the two beside
   it read as the only one that did anything. */
.player__pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  min-width: 34px;
  font-family: var(--grav-font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 0.74rem;
  color: var(--grav-brown);
  border: 1px solid rgb(220 192 142 / 0.5);
  border-radius: 20px;
  padding: 0.2rem 0.5rem;
  cursor: pointer;
}

.player__pill:disabled {
  opacity: 0.6;
  cursor: default;
}

.player__queue {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-weight: 600;
  font-size: 0.8rem;
  color: var(--grav-on-brown);
  background: var(--grav-brown);
  padding: 0.25rem 0.6rem;
  border-radius: 2px;
  white-space: nowrap;
  text-decoration: none;
  flex: 0 0 auto;
}

/* Bleeding off the right edge, as drawn. */
.player__mascot {
  width: 92px;
  height: 78px;
  background-position: right bottom;
  background-size: contain;
  background-repeat: no-repeat;
  margin-right: -0.6rem;
  flex: 0 0 auto;
  filter: drop-shadow(0 2px 3px rgb(0 0 0 / 0.6));
}

@media (max-width: 720px) {
  .player {
    gap: 0.55rem;
    padding: 0 0.6rem;
  }

  .player__wave,
  .player__time,
  .player__mascot {
    display: none;
  }

  .player__meta {
    flex: 1;
    min-width: 0;
    max-width: none;
  }

  /* One pill survives; share and download live in the row and on the
     permalink, which is where a phone reaches them.

     ⚠️ **Which one survives is decided by the DOM order, and that is why
     `Marcar este momento` is written first** (2026-08-26). For a clip the
     survivor is the vote, as it always was; for an episode it is the mark —
     which is the right one to keep, because marking a moment is a thing done
     on a phone, walking, with the episode in your ears. */
  .player__pill:not(:first-child) {
    display: none;
  }

  /* ⚠️ With the waveform gone this rule is the only place the position is
     either drawn or changed, so here — and nowhere else — it stops being a
     border and becomes a track with a fill and a handle over it. */
  .player__progress {
    background: rgb(220 192 142 / 0.3);
  }

  .player__progress-fill {
    display: block;
  }

  .player__seek {
    display: block;
  }
}
</style>
