<script setup lang="ts">
/**
 * One episode: **the episode itself, and every clip cut from it.** Route
 * `/episode/:title`, name `episode`.
 *
 * ⚠️ **The episode is playable here since 2026-08-25, and that is what this
 * screen is now for.** Until then the only place on the site that made an
 * episode's audio sound was `/creator/:id` — the clip editor, a working screen
 * with three handles and a zoom — so "I just want to listen to this episode"
 * had no answer at all. The panel below the header is the accepted design
 * ("mapa del episodio"): the measured waveform of the whole file, the clips
 * already published drawn on top of it as bands, and one transport.
 *
 * The map is not decoration. On this data the shape of an episode's clips is
 * the fact a list cannot state: episode 93 has six clips in its first hour,
 * ninety minutes of nothing, and five more crammed into its last eight minutes.
 * Hovering a band lights its row and hovering a row lights its band, so the two
 * halves of the screen are visibly about the same audio.
 *
 * ⚠️ **It sounds through the GLOBAL player, as a queue item** — the episode is
 * a `QueuedEpisode` and goes through `queue.playNow`, exactly as the clip
 * permalink's `Escuchar` does. The rejected alternative was the editor's: its
 * own `<audio>` element, owned by the view. Two reasons: a row on this site has
 * no play button precisely because there is only ever one transport, and an
 * episode is three hours long, so walking off this page — to the library, to a
 * clip — must not cut it off.
 *
 * ⚠️ **The length comes from the waveform, not from the episode.**
 * `GET /episodes/:id` carries no duration (the column exists and is not
 * surfaced), while `GET /episodes/:id/waveform` answers `to` — the measured
 * length in seconds — as a side effect of the request this screen makes anyway.
 * It is `0` for the nine episodes nothing has measured yet, and that case is
 * drawn rather than hidden: no bands, the placeholder wave, and the browser's
 * own reading of the file once it plays.
 *
 * ⚠️ **`:title` is `"<id>-<slug>"` and only the leading integer is parsed.**
 * `buildEpisodeUrl` writes the slug and nothing ever reads it back, so
 * `/episode/12-anything` is episode 12 — which is exactly what keeps the links
 * shared since 2019 working after the episode titles were re-scraped.
 *
 * ⚠️ **A bad id is a 404 at a 404's URL.** The error is a route, so the address
 * moves with it: the state can be linked and survives a reload, and the back
 * button does not point out of a page that never changed. `goToNotFoundPage()` / `goToErrorPage()` navigate
 * instead — see `router/error-navigation.ts` for why they `replace`.
 *
 * ⚠️ **These clips carry `up` and no `points`.** That is the API's shape
 * (`EpisodeClip`), not an omission to be filled in, and it is why the row takes
 * the episode as a separate prop: a clip inside an episode carries none of its
 * own, because the screen showing it already is the episode.
 */
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuery } from '@pinia/colada';
import type { EpisodeClip } from '#/domain/clips/clip.entity';
import type { EpisodeDetail, EpisodeWaveform } from '#/domain/episodes/episode.entity';
import type { DomainError } from '#/domain/errors';
import type { Tag } from '#/domain/tags/tag.entity';
import { useClipActions } from '@/composables/use-clip-actions';
import { useMomentActions } from '@/composables/use-moment-actions';
import { toQueuedEpisode } from '@/composables/use-queue-hydration';
import { episodeQueryOptions, episodeWaveformQueryOptions } from '@/queries/episodes.query';
import { goToErrorPage, goToNotFoundPage } from '@/router/error-navigation';
import { listenFrom, useMomentsStore, type Moment } from '@/stores/moments.store';
import { usePlaybackStore } from '@/stores/playback.store';
import { useQueueStore, type QueuedClip } from '@/stores/queue.store';
import { formatDate, formatDateFull } from '@/utils/format-date';
import { formatClipTime } from '@/utils/format-time';
import { averageToBars, MAX_WAVEFORM_POINTS } from '@/utils/waveform-bars';
import ClipRowItem from '@/components/ClipRowItem.vue';
import GravWave from '@/components/GravWave.vue';
/** ⚠️ The `.card-to-add` background. It is
 *  the app's own art and this is the only screen that has ever used it.
 *  ⚠️ Re-exported with a real alpha channel on 2026-08-25 — see the empty
 *  state's note at the bottom of this file. */
import emptyArt from '../../assets/gravinaBehindrecortadopeke.png';

const route = useRoute();
const router = useRouter();
const playback = usePlaybackStore();
const queue = useQueueStore();
const actions = useClipActions();
const moments = useMomentsStore();
const momentActions = useMomentActions();

/** ⚠️ `parseInt`, not `Number`: it stops at the first non-digit, which is the
 *  whole point of the `"<id>-<slug>"` form. `Number('12-x')` would be `NaN`. */
function parseEpisodeId(title: unknown): number {
  return Number.parseInt(String(title ?? ''), 10);
}

/**
 * ⚠️ **A ref fed by a guarded watcher, NOT a plain computed over the route.**
 * This view outlives its own route: `<RouterView>` fades it out with
 * `mode="out-in"`, so it is still mounted — and its watchers still firing —
 * after `route.params.title` has become `undefined`. A computed would turn that
 * into `NaN`, the guard below would read it as "not an episode", and the visitor
 * would be bounced to `/error/404` from wherever they were actually going. Both
 * the tag-click navigation and the error redirect hit that, and the tests here
 * are what found it.
 *
 * Only a change that happens WHILE this is still the episode route is adopted,
 * which also covers `/episode/12` → `/episode/15`: the component is reused and
 * the id must follow.
 */
const episodeId = ref(parseEpisodeId(route.params.title));
watch(
  () => route.params.title,
  (title) => {
    if (route.name === 'episode') episodeId.value = parseEpisodeId(title);
  },
);

const isKnownId = computed(() => Number.isInteger(episodeId.value) && episodeId.value > 0);

/**
 * ⚠️ Composed here rather than through `useEpisode()` for one reason: `enabled`.
 * `/episode/melocoton` parses to `NaN`, and without the guard the view would
 * fire `GET /api/episodes/NaN` on its way out — a request the backend answers
 * 400 to, which `goToErrorPage` would then map to the *unknown* error page
 * instead of the 404 the address deserves. The factory itself stays untouched:
 * every other caller has a real id in hand.
 */
const episodeQuery = useQuery<EpisodeDetail, DomainError>(() => ({
  ...episodeQueryOptions(episodeId.value),
  enabled: isKnownId.value,
}));

const episode = computed(() => episodeQuery.data.value);

watch(
  isKnownId,
  (known) => {
    if (!known) void goToNotFoundPage(router);
  },
  { immediate: true },
);

watch(
  episodeQuery.error,
  (error) => {
    // A `NotFoundError` lands on `/error/404`, anything else on `/error`.
    if (error) void goToErrorPage(error, router);
  },
  // ⚠️ `immediate`, for the cached-failure case: coming back to an id that
  // already failed hands this view an error that never *changes*, and without
  // it the screen would sit on the ripple forever waiting for a transition.
  { immediate: true },
);

/* ── The map ─────────────────────────────────────────────────────────────── */

/**
 * How many bars the panel draws.
 *
 * ⚠️ The request asks for `MAX_WAVEFORM_POINTS` and `averageToBars` brings it
 * down to this — see `utils/waveform-bars.ts` for why asking the server for 320
 * points directly draws a rectangle. 320 is what a 1100 px panel fits at the
 * 2 px bar + 1 px gap `GravWave` draws.
 */
const MAP_BARS = 320;

/** ⚠️ No `from`/`to`: that is what makes it the WHOLE episode, and it is also a
 *  different cache entry from every clip slice of the same episode. */
const waveformQuery = useQuery<EpisodeWaveform, DomainError>(() => ({
  ...episodeWaveformQueryOptions(episodeId.value, { points: MAX_WAVEFORM_POINTS }),
  enabled: isKnownId.value,
}));

const peaks = computed(() => averageToBars(waveformQuery.data.value?.peaks ?? [], MAP_BARS));

const isCurrent = computed(() => playback.isCurrentEpisode(episodeId.value));
const isPlaying = computed(() => playback.isPlayingEpisode(episodeId.value));

/**
 * The episode's length in seconds, or `0` while nobody knows it.
 *
 * ⚠️ Two sources, in this order and no other: the measured waveform's `to`, and
 * — for an episode nothing has measured — what the browser reports once it is
 * the thing playing. The map, the scale and the bands all wait on this, which
 * is why the panel has a "midiendo el episodio…" state at all.
 */
const durationSeconds = computed(() => {
  const measured = waveformQuery.data.value?.to ?? 0;
  if (measured > 0) return measured;
  return isCurrent.value ? playback.duration : 0;
});

const hasScale = computed(() => durationSeconds.value > 0);
const durationLabel = computed(() =>
  hasScale.value ? formatClipTime(durationSeconds.value) : '--:--',
);
const elapsedLabel = computed(() => formatClipTime(isCurrent.value ? playback.elapsed : 0));

/** `0..1` through the episode, and `0` when the episode is not what is playing:
 *  a red half-drawn wave on a page you only opened would claim you had listened
 *  to it. */
const progress = computed(() => {
  if (!isCurrent.value || playback.duration <= 0) return 0;
  return Math.min(1, Math.max(0, playback.elapsed / playback.duration));
});

interface MapBand {
  readonly clip: EpisodeClip;
  readonly left: number;
  readonly width: number;
}

/**
 * Where each published clip sits on the map, in percent.
 *
 * ⚠️ **A minimum width, and it is load-bearing.** The shortest clip on episode
 * 93 runs 39 seconds against a three-hour file — 0,36 %, which on a 390 px phone
 * is one pixel and on any screen is not something a finger can hit. `0.6 %`
 * keeps the shortest band tappable; the cost is that two clips seconds apart
 * touch, which the tooltip and the row highlight resolve.
 */
const bands = computed((): MapBand[] => {
  const total = durationSeconds.value;
  const clips = episode.value?.clips ?? [];
  if (total <= 0) return [];

  return clips.map((clip) => {
    const left = Math.min(100, Math.max(0, (clip.start / total) * 100));
    const width = Math.max(0.6, Math.min(100 - left, ((clip.end - clip.start) / total) * 100));
    return { clip, left, width };
  });
});

/** The clip the pointer is over, in either half of the screen. `null` for
 *  neither. ⚠️ Hover only — it is a highlight, not a selection, and nothing
 *  about it survives the pointer leaving. */
const markedClipId = ref<number | null>(null);

function mark(clipId: number | null): void {
  markedClipId.value = clipId;
}

/* ── Playing ─────────────────────────────────────────────────────────────── */

/** The episode as a queue item. ⚠️ Carries the measured length when there is
 *  one, so the player's `mm:ss / mm:ss` is right from the first frame instead
 *  of waiting for the browser to read the file. */
const queuedEpisode = computed(() => {
  const source = episode.value;
  return source === undefined ? undefined : toQueuedEpisode(source, durationSeconds.value);
});

/** `Escuchar el episodio` / `Pausar`. ⚠️ Same three-way shape as the clip
 *  permalink's: pause what is playing, resume what is loaded, otherwise start. */
function togglePlay(): void {
  const item = queuedEpisode.value;
  if (item === undefined) return;

  if (isPlaying.value) {
    playback.pause();
    return;
  }
  if (isCurrent.value) {
    playback.resume();
    return;
  }
  queue.playNow(item);
}

/**
 * A click anywhere on the wave: **listen to the episode from there.**
 *
 * ⚠️ It starts the episode if it was not playing, rather than doing nothing —
 * "from here" is a play instruction, and asking somebody to press play first
 * and then find the same spot again is the interaction this map exists to
 * replace. The seek is applied after `playNow` on purpose; `playback.seek`
 * knows to re-apply it once the stream has metadata.
 */
function seekToPoint(event: MouseEvent): void {
  const total = durationSeconds.value;
  if (total <= 0) return;

  const bar = event.currentTarget;
  if (!(bar instanceof HTMLElement)) return;
  const { left, width } = bar.getBoundingClientRect();
  if (width === 0) return;

  const fraction = Math.min(1, Math.max(0, (event.clientX - left) / width));
  playEpisodeFrom(fraction * total);
}

/** Start the episode — or keep it going — and put the playhead at `seconds`.
 *  Extracted from `seekToPoint` when the moments got their own way in
 *  (2026-08-26): a mark and a click on the wave are the same instruction. */
function playEpisodeFrom(seconds: number): void {
  const item = queuedEpisode.value;
  if (item === undefined) return;

  if (!isCurrent.value) queue.playNow(item);
  playback.seek(seconds);
}

/** A clip on the map or in the list, as the queue holds it. */
function toQueuedClip(clip: EpisodeClip): QueuedClip | undefined {
  const source = episode.value;
  if (source === undefined) return undefined;

  return {
    kind: 'clip',
    id: clip.id,
    title: clip.title,
    start: clip.start,
    end: clip.end,
    // A clip has no audio file of its own: this is the EPISODE's remote mp3.
    src: source.file,
    episodeId: source.id,
    episodeTitle: source.title,
    cover: source.cover,
    up: clip.up,
  };
}

/**
 * A band pressed: **play that clip.**
 *
 * ⚠️ Not "seek the episode to it", which was the other candidate. A clip is a
 * first-class thing on this site with a permalink, a vote and a queue button,
 * and every other control that names one plays that one — a band that instead
 * moved the episode's playhead would be the single exception, and it would also
 * keep playing straight past the clip's end.
 */
function playBand(clip: EpisodeClip): void {
  const queued = toQueuedClip(clip);
  if (queued !== undefined) queue.playNow(queued);
}

/* ── Mis momentos ────────────────────────────────────────────────────────── */

/**
 * The marks this visitor made on this episode (2026-08-26).
 *
 * ⚠️ **They are drawn in their OWN lane, 18 px above the wave, and never on
 * it.** The wave already carries the published clips as bands, and a mark
 * inside a band would be two controls fighting for one click — on episode 99
 * six of the seven cuts are inside twenty minutes, so that collision is the
 * normal case rather than the edge one. The lane also keeps the pin's target
 * away from the seek surface underneath it.
 *
 * ⚠️ **They are private and the screen says so.** Nothing here reaches the
 * server: see `stores/moments.store.ts` for why a list of the seconds somebody
 * laughed at is not data this project collects.
 */
const episodeMoments = computed((): Moment[] => moments.forEpisode(episodeId.value));

interface MomentPin {
  readonly moment: Moment;
  readonly left: number;
}

/** Where each mark sits on the map, in percent. ⚠️ Same arithmetic as `bands`,
 *  minus the minimum width: a pin has no length to lose. */
const momentPins = computed((): MomentPin[] => {
  const total = durationSeconds.value;
  if (total <= 0) return [];

  return episodeMoments.value.map((moment) => ({
    moment,
    left: Math.min(100, Math.max(0, (moment.at / total) * 100)),
  }));
});

/** The mark the pointer is over, in either half of the screen. `null` for
 *  neither — the same hover link the clips already have, through its own ref so
 *  a clip and a moment at the same second cannot light each other up. */
const markedMomentAt = ref<number | null>(null);

function markMoment(at: number | null): void {
  markedMomentAt.value = at;
}

const momentsNote = computed(() => {
  const count = episodeMoments.value.length;
  const noun = count === 1 ? '1 momento' : `${count} momentos`;
  return `${noun} · solo en este navegador`;
});

/** `Marcar este momento`, the episode transport's copy of the player's pill.
 *  ⚠️ Only while this episode is what is sounding: there is no "current second"
 *  to mark otherwise, and a button that marked 00:00 because nothing was playing
 *  would be worse than one that is visibly unavailable. */
function markCurrentMoment(): void {
  if (!isCurrent.value) return;
  momentActions.mark(episodeId.value, playback.elapsed);
}

const markLabel = computed(() =>
  isCurrent.value ? 'Marcar este momento' : 'Escucha el episodio para marcar un momento',
);

/** `marcado el 26/08/2026`, or just `marcado` for a mark that arrived without a
 *  usable timestamp (hand-edited storage, or one written before this field). */
function markedLabel(moment: Moment): string {
  return moment.markedAt > 0 ? `marcado el ${formatDate(new Date(moment.markedAt))}` : 'marcado';
}

/** The clip published from a mark, when it still exists. ⚠️ `undefined` is a
 *  real case and not a bug: the admin surface hard-deletes clips, and the mark
 *  outlives that — it goes back to offering `Cortar`, which is the truth. */
function cutClip(moment: Moment): EpisodeClip | undefined {
  if (moment.clipId === undefined) return undefined;
  return episode.value?.clips.find((clip) => clip.id === moment.clipId);
}

function playMoment(moment: Moment): void {
  playEpisodeFrom(listenFrom(moment));
}

function shareEpisode(): void {
  const source = episode.value;
  if (source !== undefined) void actions.shareEpisode(source);
}

/** The editor takes the bare id. */
const creatorRoute = computed(() => ({
  name: 'creator' as const,
  params: { title: String(episodeId.value) },
}));

/**
 * A tag clicked on a card. The library is the only screen that can *become* a
 * filter, so from here it is a navigation.
 */
function goToTag(tag: Tag): void {
  void router.push({ name: 'home', query: { tags: [tag] } });
}
</script>

<template>
  <main class="episode">
    <template v-if="episode">
      <!-- The episode header: the same one the editor screen carries, so the two
           screens about one episode open the same way. -->
      <div class="episode__head">
        <span class="episode__cover" :style="{ backgroundImage: `url(${episode.cover})` }" />
        <div class="episode__headings">
          <h1 class="grav-stage-title episode__title">{{ episode.title }}</h1>
          <p class="episode__meta">
            {{ formatDateFull(episode.date) }} ·
            <span class="grav-mono" data-test="episode-duration">{{ durationLabel }}</span> ·
            {{ episode.clips.length === 1 ? '1 corte' : `${episode.clips.length} cortes` }}
            <!-- ⚠️ Only when there are any, and in brown: it is the one number
                 on this line that is about the reader rather than about the
                 episode, and on an episode nobody has marked it would be a
                 `0 momentos tuyos` explaining a feature to somebody who has not
                 used it. -->
            <template v-if="episodeMoments.length > 0">
              ·
              <span class="episode__mine">
                {{
                  episodeMoments.length === 1
                    ? '1 momento tuyo'
                    : `${episodeMoments.length} momentos tuyos`
                }}
              </span>
            </template>
          </p>
        </div>
        <!-- ⚠️ The tail is dropped below 720 px, the same way the navbar says
             `Biblioteca<span class="topbar__wide"> gravinera</span>`. It is not
             cosmetic there or here: at full length this button takes ~11 rem of
             a 320 px row, which is what pushed the meta line beside it onto two
             lines. `Cortar` with the scissors is what the episode ROW says. -->
        <RouterLink class="episode__cut" :to="creatorRoute">
          <v-icon icon="mdi-content-cut" size="14" aria-hidden="true" />
          <!-- ⚠️ The label is ONE flex item, tail included. `.episode__cut` is a
               flex box with a `gap`, so a bare text node beside the span would
               be a second item and the gap would land between the two halves of
               a single word pair — `Cortar  un momento`. Wrapped, the space
               inside is an ordinary one. -->
          <span>Cortar<span class="episode__cut-wide"> un momento</span></span>
        </RouterLink>
      </div>

      <!-- ── The map ────────────────────────────────────────────────────── -->
      <section class="grav-panel episode__stage">
        <div class="ep-map" :class="{ 'has-lane': momentPins.length > 0 }">
          <!-- ⚠️ A `<button>`, not a `<span>` with a handler: it is the seek
               control, and a button is what a keyboard can reach. -->
          <button
            type="button"
            class="ep-map__wave"
            :aria-label="`Escuchar ${episode.title} desde un punto`"
            @click="seekToPoint"
          >
            <GravWave :progress="progress" :seed="episode.id" :bars="MAP_BARS" :peaks="peaks" />
          </button>

          <!-- ⚠️ Drawn OVER the wave and each one its own control. `title` is
               the hover affordance and `aria-label` the spoken one; they differ
               because the first has room for the timecode and the second reads
               better without it. -->
          <button
            v-for="band of bands"
            :key="band.clip.id"
            type="button"
            class="ep-map__band"
            :class="{ 'is-marked': markedClipId === band.clip.id }"
            :style="{ left: `${band.left}%`, width: `${band.width}%` }"
            :title="`Nº ${band.clip.id} · ${band.clip.title} · ${formatClipTime(band.clip.start)}`"
            :aria-label="`Escuchar el corte ${band.clip.title}`"
            @click="playBand(band.clip)"
            @mouseenter="mark(band.clip.id)"
            @mouseleave="mark(null)"
            @focus="mark(band.clip.id)"
            @blur="mark(null)"
          />

          <!-- Where playback is. ⚠️ Only while this episode is the thing
               playing; a playhead on a page you merely opened is a lie. -->
          <span
            v-if="isCurrent && hasScale"
            class="ep-map__head"
            :style="{ left: `${progress * 100}%` }"
            aria-hidden="true"
          />

          <!-- ── Mis momentos, in their own lane ─────────────────────────────
               ⚠️ **Above the wave, not on it.** See `episodeMoments` for why
               the collision with the clip bands is the normal case here.
               ⚠️ **A pin plays the episode from the mark**, and does not open a
               menu: every other control on this screen that names a position
               plays it (the wave seeks, a band plays that clip), and the row
               below carries the three-way choice for the same mark. -->
          <div v-if="momentPins.length > 0" class="ep-lane">
            <button
              v-for="pin of momentPins"
              :key="pin.moment.at"
              type="button"
              class="ep-lane__pin"
              :class="{ 'is-marked': markedMomentAt === pin.moment.at }"
              :style="{ left: `${pin.left}%` }"
              :title="`Mi momento · ${formatClipTime(pin.moment.at, true)}`"
              :aria-label="`Escuchar mi momento de ${formatClipTime(pin.moment.at, true)}`"
              data-test="moment-pin"
              @click="playMoment(pin.moment)"
              @mouseenter="markMoment(pin.moment.at)"
              @mouseleave="markMoment(null)"
              @focus="markMoment(pin.moment.at)"
              @blur="markMoment(null)"
            />
          </div>
        </div>

        <!-- The window's two ends with the clock between them — the editor's
             `ed-scale`, which is where this pattern already lives. -->
        <div class="ep-scale grav-mono">
          <span>00:00</span>
          <b data-test="episode-elapsed">{{ elapsedLabel }}</b>
          <span>{{ durationLabel }}</span>
        </div>

        <div class="ep-legend grav-mono">
          <template v-if="hasScale">
            <span v-if="bands.length > 0"><i class="ep-legend__clip" />cortes publicados</span>
            <span v-if="momentPins.length > 0"><i class="ep-legend__mine" />mis momentos</span>
            <span><i class="ep-legend__wave" />el episodio</span>
            <span class="ep-legend__hint">
              {{
                bands.length > 0
                  ? 'pulsa la onda para escuchar el episodio · pulsa una banda para ir a un corte'
                  : 'pulsa la onda para escuchar el episodio desde ahí'
              }}
            </span>
          </template>
          <!-- ⚠️ The nine episodes with no measured waveform, and the moment
               before the request answers. The wave below is `GravWave`'s drawn
               placeholder and the scale is unknown, so nothing here pretends
               otherwise. -->
          <span v-else>midiendo el episodio…</span>
        </div>

        <!-- ⚠️ **Both labels are hidden below 720 px, so both buttons need an
             `aria-label`** — the visible words were the accessible name, and a
             control that loses its name to a media query is a control a screen
             reader announces as "botón". The names say the same thing the words
             did, which is also what `title` shows on hover. -->
        <div class="ep-transport">
          <button
            type="button"
            class="ep-transport__play"
            :aria-label="isPlaying ? 'Pausar' : 'Escuchar el episodio'"
            :title="isPlaying ? 'Pausar' : 'Escuchar el episodio'"
            @click="togglePlay"
          >
            <v-icon :icon="isPlaying ? 'mdi-pause' : 'mdi-play'" size="15" aria-hidden="true" />
            <span class="ep-transport__label">
              {{ isPlaying ? 'Pausar' : 'Escuchar el episodio' }}
            </span>
          </button>

          <!-- ⚠️ **The player's pill, said again where the wave is** (2026-08-26).
               The player is the one that must carry it — it is the thing that
               keeps sounding when you walk off this page — but this is the
               screen you are looking at while the episode plays, and asking
               somebody to aim at a 28 px target in the bottom bar while they
               are watching the map here is the interaction the second copy
               removes. It is disabled rather than hidden when the episode is
               not what is sounding: there is no current second to mark, and a
               control that appears and disappears moves the clock beside it. -->
          <button
            type="button"
            class="q-btn ep-transport__mark"
            :disabled="!isCurrent"
            :aria-label="markLabel"
            :title="markLabel"
            data-test="mark-moment"
            @click="markCurrentMoment"
          >
            <v-icon icon="mdi-star-plus-outline" size="15" aria-hidden="true" />
            <span class="ep-transport__label">Marcar momento</span>
          </button>

          <span class="ep-transport__time grav-mono">
            {{ elapsedLabel }} / {{ durationLabel }}
          </span>

          <button
            type="button"
            class="q-btn ep-transport__share"
            aria-label="Compartir el episodio"
            title="Compartir el episodio"
            @click="shareEpisode"
          >
            <v-icon icon="mdi-link-variant" size="15" aria-hidden="true" />
            <span class="ep-transport__label">Compartir el episodio</span>
          </button>
        </div>
      </section>

      <!-- ── Mis momentos ────────────────────────────────────────────────────
           ⚠️ **Above the published cuts, and named with the possessive.** The
           section below is called `Los mejores momentos`, so two things called
           "momentos" share this screen: the
           one that belongs to everybody, and the one that belongs to you. The
           possessive is what tells them apart, and the note under the heading
           says the rest — these live in this browser and nowhere else.

           ⚠️ **The section is absent, not empty, when there are no marks.** An
           empty state here would be a box explaining a feature to somebody who
           has not used it, on the screen where the button to use it is. -->
      <template v-if="episodeMoments.length > 0">
        <h2 class="episode__subhead grav-mono">
          Mis momentos <span class="episode__subhead-note">{{ momentsNote }}</span>
        </h2>

        <div class="grav-list" data-test="moment-list">
          <div
            v-for="moment of episodeMoments"
            :key="moment.at"
            class="moment"
            :class="{ 'is-marked': markedMomentAt === moment.at }"
            @mouseenter="markMoment(moment.at)"
            @mouseleave="markMoment(null)"
          >
            <!-- ⚠️ The timecode IS the row's title. A mark has no name and no
                 cover, and borrowing the episode's would draw something that
                 looks like a clip and is not one. -->
            <span class="moment__at grav-mono">{{ formatClipTime(moment.at, true) }}</span>

            <p class="moment__meta">
              {{ markedLabel(moment) }}
              <!-- ⚠️ The mark survives the cut and says so — the accepted answer
                   of three (2026-08-26). A clip its admin has since deleted
                   falls back to `sin cortar`, because that is again true. -->
              <RouterLink
                v-if="cutClip(moment)"
                class="moment__chip moment__chip--cut"
                :to="{ name: 'clip', params: { id: moment.clipId } }"
              >
                ya es el corte nº {{ moment.clipId }}
              </RouterLink>
              <span v-else class="moment__chip">sin cortar</span>
            </p>

            <div class="moment__side">
              <button
                type="button"
                class="q-btn moment__listen"
                :aria-label="`Escuchar el episodio desde ${formatClipTime(moment.at, true)}`"
                @click="playMoment(moment)"
              >
                <v-icon icon="mdi-play" size="15" aria-hidden="true" />
                <span class="moment__label">Escuchar desde aquí</span>
              </button>

              <!-- ⚠️ Only when there is nothing cut from it yet: offering to cut
                   the same second twice is offering to publish a duplicate. -->
              <RouterLink
                v-if="!cutClip(moment)"
                class="q-btn"
                :to="momentActions.cutRoute(moment, durationSeconds)"
                :aria-label="`Cortar a partir de ${formatClipTime(moment.at, true)}`"
                data-test="moment-cut"
              >
                <v-icon icon="mdi-content-cut" size="15" aria-hidden="true" />
                <span class="moment__label">Cortar</span>
              </RouterLink>

              <button
                type="button"
                class="q-btn moment__forget"
                :aria-label="`Borrar mi momento de ${formatClipTime(moment.at, true)}`"
                :title="`Borrar mi momento de ${formatClipTime(moment.at, true)}`"
                @click="momentActions.remove(moment)"
              >
                <v-icon icon="mdi-close" size="15" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </template>

      <h2 class="episode__subhead grav-mono">Los mejores momentos</h2>

      <div v-if="episode.clips.length > 0" class="grav-list">
        <!-- ⚠️ The wrapper is what carries the hover link with the map. The row
             component publishes no hover event and should not: it is the same
             row the library and the permalink draw, and none of them have a
             map to light up. -->
        <div
          v-for="clip of episode.clips"
          :key="clip.id"
          class="episode__row"
          :class="{ 'is-marked': markedClipId === clip.id }"
          @mouseenter="mark(clip.id)"
          @mouseleave="mark(null)"
        >
          <!-- ⚠️ `compact` hides the row's episode line:
               the episode is already the page. The episode itself goes in as a
               separate prop because an `EpisodeClip` carries none of its own. -->
          <ClipRowItem :clip="clip" :episode="episode" compact @select-tag="goToTag" />
        </div>
      </div>

      <!-- ── The empty state ────────────────────────────────────────────────
           ⚠️ **The joke is content and stays verbatim** — it is the same
           sentence the library and `/cola` print, and it is the voice of the
           site. The box around it is a plain `grav-panel`, not a 220 px slab
           with the art pinned to its corner as a `background-image`: that would
           be the only surface of that size on the site with no data in it, and
           this screen's language has no room for one.

           ⚠️ **The art had no alpha channel.** `gravinaBehindrecortadopeke.png`
           carried an opaque `#f6f6f6` ground, a literal white rectangle on this
           dark panel. It is
           re-exported with real transparency, and it is a watermark now: a
           normal `grav-panel`, the drawing bleeding off the right edge under a
           gradient mask. -->
      <div v-else class="grav-panel episode__empty">
        <div class="episode__empty-text">
          <p>Esto está más vacío que la petaca de Melocotón Cane</p>
          <RouterLink class="episode__cut" :to="creatorRoute">
            <v-icon icon="mdi-content-cut" size="14" aria-hidden="true" />
            Corta el primero
          </RouterLink>
        </div>
        <img class="episode__empty-art" :src="emptyArt" alt="" aria-hidden="true" />
      </div>
    </template>

    <!-- No error branch, and that is not an oversight: every failure here
         navigates away (see the watchers above), so there is nothing left for
         this screen to render but a line saying it is on its way. -->
    <p v-else class="episode__loading grav-mono">cargando el episodio…</p>
  </main>
</template>

<style scoped>
.episode {
  padding: 1.1rem;
  max-width: 1100px;
  margin: 0 auto;
}

.episode__head {
  display: flex;
  gap: 0.9rem;
  align-items: center;
  padding-bottom: 0.8rem;
  margin-bottom: 0.9rem;
  border-bottom: 1px solid rgb(220 192 142 / 0.16);
}

.episode__cover {
  flex: 0 0 auto;
  width: 64px;
  height: 64px;
  border-radius: 2px;
  background-color: var(--grav-stage-panel);
  background-size: cover;
  background-position: center;
}

.episode__headings {
  flex: 1;
  min-width: 0;
}

.episode__title {
  font-size: 1.7rem;
  overflow-wrap: anywhere;
}

.episode__meta {
  margin: 0.18rem 0 0;
  font-size: 0.78rem;
  color: var(--grav-stage-ink-muted);
}

/* ⚠️ Brown, like everything on this site that belongs to the reader rather than
   to the podcast: the queue pill, the player, the timecodes. */
.episode__mine {
  color: var(--grav-brown);
}

.episode__cut {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8rem;
  font-weight: 600;
  background: rgb(var(--v-theme-primary));
  color: var(--grav-stage-ink);
  border-radius: 3px;
  padding: 0.25rem 0.7rem;
  text-decoration: none;
  white-space: nowrap;
  flex: 0 0 auto;
}

/* ── The map ─────────────────────────────────────────────────────────────── */
.episode__stage {
  margin-bottom: 0.4rem;
}

.ep-map {
  position: relative;
  height: 74px;
}

.ep-map__wave {
  display: block;
  width: 100%;
  height: 100%;
  cursor: pointer;
  /* The unplayed bars are the panel's own grey and the played half the accent —
     the clip permalink's hero, so an episode's wave and a clip's read alike. */
  --grav-wave-idle: #3a3735;
  --grav-wave-played: rgb(var(--v-theme-primary));
}

.ep-map__band {
  position: absolute;
  top: 0;
  bottom: 0;
  padding: 0;
  cursor: pointer;
  background: rgba(var(--v-theme-primary), 0.42);
  border-top: 2px solid rgb(var(--v-theme-primary));
  border-bottom: 2px solid rgb(var(--v-theme-primary));
}

.ep-map__band:hover,
.ep-map__band:focus-visible,
.ep-map__band.is-marked {
  background: rgba(var(--v-theme-primary), 0.72);
  border-color: #d8452c;
}

/* ⚠️ Two pixels wide and `pointer-events: none`: it sits over the wave, which
   is the seek control, and a playhead that swallowed the click at the exact
   position you are already at would be the one dead spot on the bar. */
.ep-map__head {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 2px;
  margin-left: -1px;
  background: var(--grav-brown);
  pointer-events: none;
}

.ep-scale {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 0.72rem;
  color: var(--grav-stage-ink-faint);
  margin-top: 0.3rem;
}

.ep-scale b {
  font-weight: 600;
  color: var(--grav-brown);
}

.ep-legend {
  display: flex;
  gap: 0.9rem;
  flex-wrap: wrap;
  align-items: center;
  font-size: 0.66rem;
  color: var(--grav-stage-ink-faint);
  margin-top: 0.45rem;
}

.ep-legend i {
  display: inline-block;
  width: 12px;
  height: 8px;
  margin-right: 0.35rem;
  vertical-align: middle;
}

.ep-legend__clip {
  background: rgba(var(--v-theme-primary), 0.6);
  border: 1px solid rgb(var(--v-theme-primary));
}

.ep-legend__wave {
  background: #3a3735;
}

.ep-legend__hint {
  color: var(--grav-stage-ink-muted);
}

.ep-transport {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  align-items: center;
  margin-top: 0.8rem;
}

.ep-transport__play {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.85rem;
  font-weight: 600;
  background: rgb(var(--v-theme-primary));
  color: var(--grav-stage-ink);
  border-radius: 3px;
  padding: 0.3rem 0.75rem;
  cursor: pointer;
}

.ep-transport__time {
  font-size: 0.8rem;
  color: var(--grav-stage-ink-muted);
}

/* ⚠️ Pinned to the panel's right edge at every width. The two controls either
   side of the clock do different jobs — one plays the episode, the other copies
   a link — and grouping them a `gap` apart put the second one under a cursor
   (or a thumb) aiming for the first. The space between them is the separation. */
.ep-transport__share {
  margin-left: auto;
}

/* ⚠️ The same outlined control the clip permalink uses, repeated rather than
   shared: `.q-btn` is declared in three views and lifting it into
   `gravinero.css` is its own change, not a side effect of this one. */
.q-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.82rem;
  border: 1px solid var(--grav-hairline-strong);
  border-radius: 4px;
  padding: 0.28rem 0.6rem;
  color: #d9d4cd;
  cursor: pointer;
}

.q-btn:hover,
.q-btn:focus-visible {
  border-color: var(--grav-brown);
  color: var(--grav-brown);
}

.episode__subhead {
  font-size: 0.66rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--grav-brown);
  margin: 1.2rem 0 0.4rem;
}

/* ⚠️ The heading's own tail, not a second line: `Mis momentos` has to say where
   they live, and a paragraph under it would push the first row down on every
   visit for a sentence that is read once. Lower case and unspaced so it reads as
   an aside rather than as part of the label. */
.episode__subhead-note {
  text-transform: none;
  letter-spacing: 0;
  color: var(--grav-stage-ink-faint);
  margin-left: 0.4rem;
}

/* ── Mis momentos ────────────────────────────────────────────────────────── */

/* The lane the pins live in, above the wave and outside it. ⚠️ Declared as a
   top margin on the map rather than as extra height, so the wave keeps the 74 px
   `GravWave` is drawn at and the panel only grows when there is something to
   put up there. */
.ep-map.has-lane {
  margin-top: 18px;
}

.ep-lane {
  position: absolute;
  left: 0;
  right: 0;
  top: -18px;
  height: 18px;
}

/* ⚠️ 2 px of stem and a 12 px head: the stem says exactly which second, the
   head is what a finger can hit. The head is a rotated square rather than an
   icon so it costs no font and lines up on the half-pixel at any width. */
.ep-lane__pin {
  position: absolute;
  bottom: 0;
  width: 2px;
  height: 100%;
  margin-left: -1px;
  padding: 0;
  background: var(--grav-brown);
  cursor: pointer;
}

.ep-lane__pin::before {
  content: '';
  position: absolute;
  top: 0;
  left: -5px;
  width: 12px;
  height: 12px;
  border-radius: 2px;
  background: var(--grav-brown);
  transform: rotate(45deg);
}

.ep-lane__pin:hover,
.ep-lane__pin:focus-visible,
.ep-lane__pin.is-marked {
  background: var(--grav-stage-ink);
}

.ep-lane__pin:hover::before,
.ep-lane__pin:focus-visible::before,
.ep-lane__pin.is-marked::before {
  background: var(--grav-stage-ink);
}

.ep-legend__mine {
  width: 8px;
  height: 8px;
  border-radius: 1px;
  background: var(--grav-brown);
  transform: rotate(45deg);
}

/* ⚠️ Unavailable, and visibly so, while the episode is not what is sounding —
   see the note on the button. `pointer-events` stays on so the `title` still
   explains why. */
.ep-transport__mark:disabled {
  opacity: 0.45;
  cursor: default;
}

.ep-transport__mark:disabled:hover {
  border-color: var(--grav-hairline-strong);
  color: #d9d4cd;
}

/* The row. ⚠️ `auto | 1fr | auto` rather than the clip row's fixed tracks: there
   is no cover, no vote and no duration here, so there is no column of glyphs to
   keep aligned against the list above — only the timecode, which is what the eye
   runs down. */
.moment {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 0.9rem;
  align-items: center;
  padding: 0.5rem 0.4rem;
  border-bottom: 1px solid rgb(220 192 142 / 0.16);
}

.moment.is-marked {
  background: rgb(220 192 142 / 0.07);
}

.moment__at {
  font-size: 0.95rem;
  color: var(--grav-brown);
}

.moment__meta {
  margin: 0;
  font-size: 0.76rem;
  color: var(--grav-stage-ink-muted);
}

.moment__chip {
  display: inline-block;
  font-size: 0.68rem;
  border: 1px solid rgb(220 192 142 / 0.16);
  border-radius: 10px;
  padding: 0 0.45rem;
  margin-left: 0.35rem;
  color: var(--grav-stage-ink-faint);
  text-decoration: none;
}

.moment__chip--cut {
  color: var(--grav-brown);
  border-color: var(--grav-hairline-strong);
}

.moment__side {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.moment__side .q-btn {
  text-decoration: none;
}

.moment__forget:hover,
.moment__forget:focus-visible {
  border-color: rgb(var(--v-theme-error));
  color: rgb(var(--v-theme-error));
}

/* The other half of the map's hover link. ⚠️ A background on the WRAPPER, not
   on the row: the row paints its own when it is the clip playing, and two rules
   fighting over one surface is how that state would flicker. */
.episode__row.is-marked {
  background: rgb(220 192 142 / 0.07);
}

/* ── The empty state ─────────────────────────────────────────────────────── */
.episode__empty {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: 1.2rem;
  min-height: 132px;
}

.episode__empty-text {
  position: relative;
  z-index: 1;
  max-width: 40ch;
}

.episode__empty-text p {
  margin: 0 0 0.8rem;
  color: var(--grav-stage-ink-muted);
}

/* ⚠️ The mask is what makes it a watermark rather than a picture stuck to the
   corner: the drawing fades into the panel from the left instead of ending at
   an edge. It relies on the PNG's real alpha channel; over an opaque copy this
   would fade a white rectangle in. */
.episode__empty-art {
  position: absolute;
  right: -6px;
  bottom: -10px;
  height: 152px;
  opacity: 0.78;
  pointer-events: none;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 38%);
  mask-image: linear-gradient(90deg, transparent, #000 38%);
}

.episode__loading {
  padding: 3rem 0;
  text-align: center;
  font-size: 0.75rem;
  color: var(--grav-stage-ink-faint);
}

@media (max-width: 720px) {
  .episode {
    padding: 0.8rem 0.7rem;
  }

  /*
   * ⚠️ **Two rows on a phone, and they are declared rather than emergent**:
   * the cover beside the title, then the meta line beside the cut button.
   *
   * As a wrapping flex row this was four: `Cortar un momento` does not wrap (it
   * is one action) so it took a fixed ~11 rem out of a 320 px line, and pushing
   * the headings onto their own line to save the title left the cover sitting
   * alone above them. Four rows of chrome before a single word of the episode.
   *
   * ⚠️ `display: contents` on the headings is what makes it possible: the title
   * and the meta are siblings inside a wrapper, and the grid has to place them
   * on different rows. It is the same trick `EditorView`'s `ed-bar__row` uses,
   * for the same reason.
   */
  .episode__head {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas:
      'cover title title'
      'meta  meta  cut';
    align-items: center;
    column-gap: 0.7rem;
    row-gap: 0.5rem;
  }

  .episode__headings {
    display: contents;
  }

  .episode__cover {
    grid-area: cover;
    width: 56px;
    height: 56px;
  }

  .episode__title {
    grid-area: title;
    font-size: 1.4rem;
  }

  .episode__meta {
    grid-area: meta;
    margin-top: 0;
  }

  .episode__cut {
    grid-area: cut;
    justify-self: end;
  }

  .episode__cut-wide {
    display: none;
  }

  .ep-map {
    height: 58px;
  }

  /*
   * ⚠️ **One line, and it does not wrap.** The transport was `play · tiempo ·
   * compartir` with both labels spelled out, which on a phone was two lines and
   * sometimes three. Below 720 px the two buttons are their glyph alone — the
   * play in the round shape the global player already uses for the same verb —
   * and the row reads `(▶) 00:00 / 41:34 ............ (🔗)`.
   *
   * ⚠️ The share button's `margin-left: auto` is NOT here — it applies at every
   * width (see the base rule above). Only the shrinking to a glyph is a phone's
   * business.
   */
  .ep-transport {
    flex-wrap: nowrap;
  }

  .ep-transport__label {
    display: none;
  }

  .ep-transport__play,
  .ep-transport__mark,
  .ep-transport__share {
    flex: 0 0 auto;
    justify-content: center;
    width: 40px;
    height: 40px;
    padding: 0;
  }

  /* Round, like `.player__play`: it is the same action in the same design. */
  .ep-transport__play {
    border-radius: 50%;
  }

  /* ⚠️ **The moment's three buttons drop to their own line**, which is the
     design's own rule for a row's side actions below 720 px. Glyph-only was the
     other candidate and it loses `Escuchar desde aquí` — the one action here
     whose meaning is not obvious from an icon, because "play" on this site
     usually means a clip and here it means the episode. */
  .moment {
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas:
      'at   meta'
      'side side';
    row-gap: 0.4rem;
  }

  .moment__at {
    grid-area: at;
  }

  .moment__meta {
    grid-area: meta;
  }

  .moment__side {
    grid-area: side;
    justify-content: flex-end;
  }

  /* ⚠️ **The drawing never goes away, at any width.** It was `display: none`
     here for one afternoon, on the theory that it would take half a phone's
     width from the text in front of it — which was solving the wrong problem:
     it is the ground of this box, not an illustration beside the text, and a
     box whose ground disappears on a phone is a different box. It shrinks and
     dims instead, and the mask below carries the text's half of the panel. */
  .episode__empty {
    min-height: 118px;
  }

  .episode__empty-art {
    right: -10px;
    bottom: -6px;
    height: 120px;
    /* Dimmer than on a wide screen because here the copy can genuinely run over
       it: 0,45 still reads as the drawing, and `--grav-stage-ink-muted` stays
       legible on top. */
    opacity: 0.45;
    -webkit-mask-image: linear-gradient(90deg, transparent, #000 45%);
    mask-image: linear-gradient(90deg, transparent, #000 45%);
  }
}
</style>
