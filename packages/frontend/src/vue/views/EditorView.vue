<script setup lang="ts">
/**
 * The clip editor. Route `/creator/:title`, name `creator`. The densest screen
 * in the app.
 *
 * You pick a start and an end over the episode's **remote mp3**, streamed and
 * seeked in place, give the cut a title and some tags, and publish it. There is
 * no audio file at the other end: a clip is `(episode, start, end, title)` and
 * the player seeks to `start` and stops at `end` (root `AGENTS.md`).
 *
 * ⚠️ **`:title` is `"<id>-<slug>"` and only the leading integer is parsed**, the
 * same as `/episode/:title`. `/creator/63` and `/creator/63-episodio-86` are the
 * same screen, and a bare id resolves too, so links that carry one still work.
 *
 * ### Why it is built this way
 *
 * - **The timeline is `ThreeHandleSlider`**, and it is a custom control — read
 *   its header for the three findings baked into it. Zoom needs no remount: the
 *   window is a reactive prop.
 * - ⚠️ **Handles clamp instead of crossing**, so `start <= playhead <= end`
 *   holds at all times and `checkInverted()` — which swapped `start` and `end`
 *   after the fact — has nothing left to do. Recorded deviation; the saved cut
 *   is identical either way.
 * - ⚠️ **Times are seconds here, not strings.** Keeping seconds removes a
 *   whole class of `NaN` (`formatTime(-1)` → `--:--:--` → `NaN` → a clip saved
 *   at `NaN` seconds), but the property that mattered is preserved and asserted:
 *   **what is published is parsed back out of what the screen displays**, so the
 *   number in the database can never disagree with the timecode the user read.
 * - **Validation is server-side now too.** A 400 arrives as a
 *   `REQUEST_REJECTED` domain error carrying the backend's own message, and that
 *   message is what the notice shows — never "no se ha podido conectar", which
 *   would be a lie about a request that arrived perfectly.
 *
 * ⚠️ **NEW: the clips already published are drawn over the timeline**, in two
 * places — a strip showing the whole episode, and dashed boxes over the zoomed
 * track for the ones that fall inside the view. They are informative only:
 * overlapping stays allowed, and this is about not doing it by accident.
 * Everything else on this screen is the existing
 * implementation, repainted.
 *
 * ⚠️ **This screen owns its audio element and does not use `playback.store`.**
 * The reasoning is in `@/utils/editor-audio`; the short version is that the
 * store plays a finished clip and this screen is making one, so its `end` moves
 * under the cursor and the store's contract is to stop there.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuery } from '@pinia/colada';
import type { EpisodeDetail } from '#/domain/episodes/episode.entity';
import type { DomainError } from '#/domain/errors';
import type { Tag } from '#/domain/tags/tag.entity';
import { episodeQueryOptions, useEpisodeWaveform } from '@/queries/episodes.query';
import { useCreateClip } from '@/queries/clips.query';
import { goToErrorPage, goToNotFoundPage } from '@/router/error-navigation';
import { useMomentsStore } from '@/stores/moments.store';
import { useNotificationsStore } from '@/stores/notifications.store';
import { usePlaybackStore } from '@/stores/playback.store';
import { domainErrorNotice } from '@/utils/domain-error-notice';
import { buildEpisodeUrl } from '@/utils/episode-url';
import { formatClipTime } from '@/utils/format-time';
import { formatHhmmss, hhmmssToSeconds } from '@/utils/timecode';
import {
  clamp,
  zoomBy,
  zoomToSelection,
  type HandleIndex,
  type SliderRange,
  type SliderValues,
} from '@/utils/slider-logic';
import { createEditorAudio, type EditorAudio } from '@/utils/editor-audio';
import GravWave from '@/components/GravWave.vue';
import TagPicker from '@/components/TagPicker.vue';
import ThreeHandleSlider from '@/components/ThreeHandleSlider.vue';

/** ⚠️ The default end: the episode minus its last ten minutes. */
const DEFAULT_TAIL_SECONDS = 10 * 60;
/**
 * How much of the episode is left visible around a cut this screen was opened
 * on. `1.5` means a margin of one and a half times the cut's own length on each
 * side — about a minute either way for the 40 s window a moment seeds.
 */
const SEEDED_ZOOM_MARGIN_RATIO = 1.5;

/** How far a zoom step widens or narrows the window on each side. */
const ZOOM_STEP_SECONDS = 10 * 60;
/**
 * The two granularities either end of the cut can be nudged by.
 *
 * ⚠️ **`±5` is gone, and that is the one thing this screen lost** (owner's
 * review, 2026-08-22). The six pills per end used to live in their own column;
 * they now sit either side of the timecode they move, and five buttons a side
 * do not fit around a number. Between one second and ten there is nothing
 * missing, and the pair matches what the keyboard already does — the slider's
 * `step` is 1 and Shift multiplies it by ten — so for the first time the
 * buttons and the arrow keys offer the same two sizes.
 */
const NUDGE_DELTAS = [-10, -1, 1, 10] as const;
/** ⚠️ Four fixed steps rather than a continuous slider: nobody edits a podcast
 *  at x3,5, and a slider here was the only control on this screen not built out
 *  of the site's own tokens. */
const PLAYBACK_RATES = [0.5, 1, 1.5, 2] as const;
/** "Ir a 5 segundos antes del final del corte". */
const END_PREVIEW_SECONDS = 5;
/** Debounce for the playhead seek. A remote mp3 must not be range-requested once
 *  per pointer move. */
const PLAYHEAD_SEEK_DELAY_MS = 1000;
/** Debounce for the relative seek buttons. */
const RELATIVE_SEEK_DELAY_MS = 100;

const route = useRoute();
const router = useRouter();
const notifications = useNotificationsStore();
const playback = usePlaybackStore();
const moments = useMomentsStore();
const createClip = useCreateClip();

/** ⚠️ `parseInt`, not `Number`: it stops at the first non-digit, which is what
 *  makes the `"<id>-<slug>"` form work. `Number('63-x')` would be `NaN`. */
function parseEpisodeId(title: unknown): number {
  return Number.parseInt(String(title ?? ''), 10);
}

/**
 * ⚠️ **A ref fed by a guarded watcher, NOT a computed over the route.** This
 * view outlives its own route: `<RouterView>` fades it out with `mode="out-in"`,
 * so it is still mounted — and its watchers still firing — after
 * `route.params.title` has become `undefined`. A computed would turn that into
 * `NaN`, the guard below would read it as "not an episode", and the visitor
 * would be bounced to `/error/404` on their way somewhere else. `EpisodeView`
 * and `ClipView` both hit this; the fix is theirs.
 */
const episodeId = ref(parseEpisodeId(route.params.title));
watch(
  () => route.params.title,
  (title) => {
    if (route.name === 'creator') episodeId.value = parseEpisodeId(title);
  },
);

const isKnownId = computed(() => Number.isInteger(episodeId.value) && episodeId.value > 0);

/* ── Opened from one of my moments ───────────────────────────────────────── */

/**
 * `?start`, `?end` and `?moment`, read **once, at setup, and never watched**
 * (2026-08-26).
 *
 * ⚠️ **Once is the whole point.** These seed the timeline; they are not bound to
 * it. A watcher would fight the three handles the moment somebody dragged one,
 * and this view outlives its own route anyway (see `episodeId` above), so a
 * computed over `route.query` would go `undefined` mid-fade and throw the cut
 * away on the way out.
 *
 * ⚠️ **`moment` is not the same number as `start`.** The window can be dragged
 * anywhere before publishing, so what identifies the mark afterwards is the mark
 * itself. It is what lets the published clip's id land back on the right row of
 * `Mis momentos`.
 *
 * ⚠️ Anything malformed is ignored rather than rejected: the URL is public, a
 * `?start=melocotón` is somebody playing, and the editor still works perfectly
 * without a seed. Nothing here can produce a cut the screen would not have
 * allowed by hand — `onCanPlay` clamps it to the episode.
 */
function readQueryNumber(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

const seededCut = ((): { start: number; end: number } | null => {
  const start = readQueryNumber(route.query.start);
  const end = readQueryNumber(route.query.end);
  return start !== null && end !== null && end > start ? { start, end } : null;
})();

/** The mark this cut came from, so `save()` can tell it what became of it. */
const seededMomentAt = readQueryNumber(route.query.moment);

/** ⚠️ `enabled`, so `/creator/melocoton` never fires `GET /episodes/NaN` — a 400
 *  that would land on the *unknown* error page instead of the 404 it deserves. */
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
    if (error) void goToErrorPage(error, router);
  },
  { immediate: true },
);

// ── The cut ──────────────────────────────────────────────────────────────────

/** `[start, playhead, end]`, in whole seconds. Always ordered. */
const points = ref<SliderValues>([0, 0, 0]);
/** The visible window of the timeline. Zoom moves this, never the values. */
const zoom = ref<SliderRange>({ min: 0, max: 0 });
/** The episode's length, once the browser has metadata. */
const duration = ref(0);

/** ⚠️ Debounced, the same idea as `PLAYHEAD_SEEK_DELAY_MS` but for the
 *  waveform: zoom moves on every pointer frame of a drag, and each distinct
 *  window is its own cache entry (`episodeKeys.waveform`) — without this, a
 *  single zoom gesture would fire dozens of requests for windows nobody ever
 *  looks at. */
const WAVEFORM_ZOOM_DEBOUNCE_MS = 300;
const waveformWindow = ref<SliderRange>({ min: 0, max: 0 });
let waveformTimer: ReturnType<typeof setTimeout> | undefined;
watch(zoom, (value) => {
  clearTimeout(waveformTimer);
  waveformTimer = setTimeout(() => {
    waveformWindow.value = { min: value.min, max: value.max };
  }, WAVEFORM_ZOOM_DEBOUNCE_MS);
});

const waveform = useEpisodeWaveform(
  () => episodeId.value,
  () => ({ from: waveformWindow.value.min, to: waveformWindow.value.max, points: 160 }),
);
/** ⚠️ The `canplay` gate: there is nothing to edit before the stream has
 *  told us how long the episode is. */
const ready = ref(false);

const title = ref('');
const tags = ref<Tag[]>([]);
const saving = ref(false);
const validation = reactive({ title: false, tags: false });

// ── The audio ────────────────────────────────────────────────────────────────

/** ⚠️ Not a `ref`: it is an imperative resource, and wrapping a media element in
 *  one only invites the template to touch it. */
let audio: EditorAudio | null = null;
const currentTime = ref(0);
const playing = ref(false);
/** Between a seek and the stream catching up — visible on a remote mp3. */
const waiting = ref(false);
const playbackRate = ref(1);
/** While the playhead handle is under the pointer, `timeupdate` must not fight
 *  the drag for it. */
const draggingPlayhead = ref(false);

let seekTimer: ReturnType<typeof setTimeout> | undefined;
let pendingRelativeSeek = 0;

function cancelPendingSeek(): void {
  if (seekTimer !== undefined) clearTimeout(seekTimer);
  seekTimer = undefined;
  pendingRelativeSeek = 0;
}

function seekAudio(seconds: number): void {
  cancelPendingSeek();
  if (audio === null) return;
  audio.currentTime = seconds;
  currentTime.value = seconds;
}

/** One range request when the drag settles, not sixty. */
function schedulePlayheadSeek(seconds: number): void {
  cancelPendingSeek();
  waiting.value = true;
  seekTimer = setTimeout(() => {
    seekTimer = undefined;
    if (audio !== null) audio.currentTime = seconds;
    waiting.value = false;
  }, PLAYHEAD_SEEK_DELAY_MS);
}

/**
 * ⚠️ The deltas **accumulate** into one pending seek, so pressing "−10" three
 * times quickly moves thirty seconds.
 */
function scheduleRelativeSeek(amount: number): void {
  if (seekTimer !== undefined) clearTimeout(seekTimer);
  pendingRelativeSeek += amount;
  waiting.value = true;
  seekTimer = setTimeout(() => {
    seekTimer = undefined;
    const delta = pendingRelativeSeek;
    pendingRelativeSeek = 0;
    if (audio !== null) audio.currentTime += delta;
    waiting.value = false;
  }, RELATIVE_SEEK_DELAY_MS);
}

/**
 * `keepInsideCut()`: the stream is never allowed to wander outside the cut. It
 * is what keeps `start <= playhead <= end` true for the audio, and since the
 * slider enforces the same invariant, it is what keeps the audio agreeing with it.
 */
function keepInsideCut(): void {
  if (audio === null) return;
  const [start, , end] = points.value;
  if (audio.currentTime < start || audio.currentTime > end) audio.currentTime = start;
}

function setPlayheadFromAudio(seconds: number): void {
  const [start, playhead, end] = points.value;
  // Floored, so the model stays on whole seconds like every other value here.
  const next = clamp(Math.floor(seconds), start, end);
  if (next !== playhead) points.value = [start, next, end];
}

function onCanPlay(): void {
  if (audio === null) return;
  waiting.value = false;
  // ⚠️ `canplay` fires again after every seek, and re-initialising the cut then
  // would throw the user's work away.
  if (ready.value) return;

  const total = Number.isFinite(audio.duration) ? Math.floor(audio.duration) : 0;
  duration.value = total;

  /**
   * ⚠️ **A cut seeded from a moment lands here**, and here rather than at setup
   * because this is the first instant the episode's length is known — a window
   * cannot be clamped against a duration nobody has yet.
   *
   * The zoom follows the cut with a generous margin: a 40 s window drawn across
   * a two-hour track is four pixels, so arriving zoomed out would show the
   * visitor nothing of what they marked. `1.5` puts about a minute either side
   * on screen, which is enough to hear where the cut should really begin and
   * still leaves the handles somewhere to be dragged.
   */
  if (seededCut !== null && total > 0) {
    const start = clamp(seededCut.start, 0, Math.max(0, total - 1));
    const end = clamp(seededCut.end, start + 1, total);
    points.value = [start, start, end];
    zoom.value = zoomToSelection(points.value, total, SEEDED_ZOOM_MARGIN_RATIO);
    // The stream is at 0 and the cut is not; `keepInsideCut` would only correct
    // it on the first `timeupdate`, i.e. after somebody pressed play and heard
    // the wrong part of the episode.
    seekAudio(start);
    ready.value = true;
    return;
  }

  // ⚠️ The default is `duration - 10 min`, but an episode shorter than ten
  // minutes keeps its whole length: a negative end would print as `--:--:--`
  // and reach `save()` as `NaN`. Nothing in the catalogue is that short today;
  // the guard costs one comparison.
  const end = total > DEFAULT_TAIL_SECONDS ? total - DEFAULT_TAIL_SECONDS : total;
  points.value = [0, 0, end];
  zoom.value = { min: 0, max: total };
  ready.value = true;
}

function onTimeUpdate(): void {
  if (audio === null) return;
  waiting.value = false;
  keepInsideCut();
  currentTime.value = audio.currentTime;
  if (!draggingPlayhead.value) setPlayheadFromAudio(audio.currentTime);
}

function onWaiting(): void {
  waiting.value = true;
}

function onEnded(): void {
  playing.value = false;
}

function detachAudio(): void {
  cancelPendingSeek();
  if (audio === null) return;
  audio.pause();
  audio.removeEventListener('canplay', onCanPlay);
  audio.removeEventListener('timeupdate', onTimeUpdate);
  audio.removeEventListener('waiting', onWaiting);
  audio.removeEventListener('ended', onEnded);
  audio = null;
}

function attachAudio(src: string): void {
  detachAudio();
  ready.value = false;
  playing.value = false;
  currentTime.value = 0;

  const element = createEditorAudio(src);
  element.playbackRate = playbackRate.value;
  element.addEventListener('canplay', onCanPlay);
  element.addEventListener('timeupdate', onTimeUpdate);
  element.addEventListener('waiting', onWaiting);
  element.addEventListener('ended', onEnded);
  audio = element;
}

watch(
  episode,
  (value) => {
    if (value) attachAudio(value.file);
  },
  { immediate: true },
);

watch(playbackRate, (value) => {
  if (audio !== null) audio.playbackRate = value;
});

onMounted(() => {
  // ⚠️ One thing plays at a time across the whole app. A clip left playing on
  // the episode page would otherwise go on talking underneath this screen's own
  // element — the only place the two audio owners can meet.
  playback.pause();
});

onBeforeUnmount(() => {
  detachAudio();
  clearTimeout(waveformTimer);
});

// ── Transport ────────────────────────────────────────────────────────────────

function togglePlay(): void {
  if (audio === null) return;
  if (playing.value) {
    audio.pause();
    playing.value = false;
    return;
  }
  keepInsideCut();
  playing.value = true;
  // ⚠️ An autoplay policy can refuse this. Not worth a toast — the button just
  // goes back to offering "play".
  void Promise.resolve(audio.play()).catch(() => {
    playing.value = false;
    waiting.value = false;
  });
}

function seekToCutStart(): void {
  seekAudio(points.value[0]);
}

function seekToCutEnd(): void {
  // ⚠️ `end - 5` is floored at `start`: on a very short cut it could go negative,
  // the browser would clamp it to 0, and `keepInsideCut` would then yank it back.
  seekAudio(Math.max(points.value[0], points.value[2] - END_PREVIEW_SECONDS));
}

// ── Moving the cut points ────────────────────────────────────────────────────

/**
 * The ±1/5/10 buttons and "Mover al punto actual", for one end of the cut.
 *
 * ⚠️ These are NOT the slider's own nudge, and the difference is deliberate. A
 * handle on the timeline stops at its neighbour, so `start` would stop at the
 * playhead — which is wherever the audio happens to be, and moves while it
 * plays. The guard is "start may not pass **end**", and that is the one kept
 * here; the playhead is carried along instead of blocking, which is exactly what
 * `keepInsideCut()` does to the stream.
 */
function moveCutPoint(point: 'start' | 'end', target: number): void {
  const [start, playhead, end] = points.value;
  const value = Math.round(target);

  if (point === 'start') {
    // A start past the end is refused outright rather than clamped.
    if (value > end) return;
    const next = clamp(value, zoom.value.min, end);
    const nextPlayhead = Math.max(playhead, next);
    points.value = [next, nextPlayhead, end];
    if (nextPlayhead !== playhead) seekAudio(nextPlayhead);
    return;
  }

  if (value < start) return;
  const next = clamp(value, start, zoom.value.max);
  const nextPlayhead = Math.min(playhead, next);
  points.value = [start, nextPlayhead, next];
  if (nextPlayhead !== playhead) seekAudio(nextPlayhead);
}

function nudgeCutPoint(point: 'start' | 'end', delta: number): void {
  moveCutPoint(point, (point === 'start' ? points.value[0] : points.value[2]) + delta);
}

function moveCutPointToPlayhead(point: 'start' | 'end'): void {
  moveCutPoint(point, currentTime.value);
}

// ── The timeline ─────────────────────────────────────────────────────────────

function onTimelineInput(next: SliderValues): void {
  const previous = points.value[1];
  points.value = next;
  // Dragging the playhead scrubs the audio — once the drag settles.
  if (next[1] !== previous) schedulePlayheadSeek(next[1]);
}

function onDragStart(index: HandleIndex): void {
  if (index === 1) draggingPlayhead.value = true;
}

function onDragEnd(index: HandleIndex): void {
  if (index === 1) draggingPlayhead.value = false;
}

function zoomToCut(): void {
  zoom.value = zoomToSelection(points.value, duration.value);
}

/**
 * ⚠️ **`Acercar` completes the pair, and it is not "Ajustar al corte".**
 * Without it the only way to zoom IN was "Ajustar al corte" — which also
 * *moves* the window somewhere specific. `zoomBy` already guards the window
 * against collapsing or inverting, so a negative step needs nothing else.
 */
function zoomIn(): void {
  const [start, , end] = points.value;
  const next = zoomBy(zoom.value, -ZOOM_STEP_SECONDS, duration.value);
  // ⚠️ **Never narrower than the cut itself**, and this is not a nicety.
  // `ThreeHandleSlider` reclamps any value that falls outside its window
  // (`reclampToRange`, watched on `min`/`max`), so a window closing past `start`
  // would not merely hide the handle — it would MOVE it, eating the cut one
  // press at a time with nothing on screen saying so. The two zooms that existed
  // before could not hit this: `zoomToCut` contains the cut by construction and
  // `zoomOut` only ever widens. Zooming in is the first one that can, so the
  // guard arrives with it.
  zoom.value = { min: Math.min(next.min, start), max: Math.max(next.max, end) };
}

function zoomOut(): void {
  zoom.value = zoomBy(zoom.value, ZOOM_STEP_SECONDS, duration.value);
}

function zoomReset(): void {
  zoom.value = { min: 0, max: duration.value };
}

// ── What the screen prints ───────────────────────────────────────────────────

// ── The clips that are already there ─────────────────────────────────────────
//
// ⚠️ **Two new layers, both INFORMATIVE ONLY**:
// a strip showing the whole episode with every published clip on it, and — over
// the zoomed waveform — dashed boxes for the ones that fall inside the current
// view.
//
// ⚠️ **They restrict nothing.** Overlapping cuts are allowed and stay allowed;
// this is about not doing it by accident. Nothing below feeds validation, and
// nothing below may start to.
//
// The data is already here: `GET /episodes/:id` returns the episode's clips,
// which is what this screen already fetches to know the episode exists.

/** Percentages, so both layers are pure CSS over the same numbers. */
interface ClipBand {
  id: number;
  title: string;
  start: number;
  end: number;
  /** `left` and `width` as percentages of whichever range is being drawn. */
  left: number;
  width: number;
}

function toBands(
  clips: readonly { id: number; title: string; start: number; end: number }[],
  from: number,
  to: number,
): ClipBand[] {
  const span = to - from;
  if (span <= 0) return [];

  return (
    clips
      // Only what is visible in this range — an episode-wide map keeps everything,
      // the zoomed track keeps the handful that overlap the window.
      .filter((clip) => clip.end > from && clip.start < to)
      .map((clip) => {
        const left = ((Math.max(clip.start, from) - from) / span) * 100;
        const right = ((Math.min(clip.end, to) - from) / span) * 100;
        return {
          id: clip.id,
          title: clip.title,
          start: clip.start,
          end: clip.end,
          left,
          // ⚠️ A floor of 0.4 %: a 20-second cut inside a 2 h 38 m episode is
          // 0.2 % wide and would round to nothing. The map exists to show that
          // something is there.
          width: Math.max(0.4, right - left),
        };
      })
  );
}

const publishedClips = computed(() => episode.value?.clips ?? []);

/** The whole-episode strip. */
const mapBands = computed(() => toBands(publishedClips.value, 0, duration.value));

/** The cut being made, on that same strip. */
const mapNewBand = computed(() => {
  const bands = toBands(
    [{ id: 0, title: '', start: points.value[0], end: points.value[2] }],
    0,
    duration.value,
  );
  return bands[0] ?? null;
});

/** The zoom window, outlined on the strip — "lo que ves abajo". */
const mapWindow = computed(() => {
  if (duration.value <= 0) return null;
  const left = (zoom.value.min / duration.value) * 100;
  const right = (zoom.value.max / duration.value) * 100;
  return { left, width: Math.max(1, right - left) };
});

/** The published clips that fall inside the zoomed view, over the track. */
const trackBands = computed(() => toBands(publishedClips.value, zoom.value.min, zoom.value.max));

/**
 * ⚠️ `episode.duration` is nullable and the browser is what supplies it here, so
 * until `canplay` there is **no scale** — the map is drawn empty and disabled
 * rather than guessing a length. A guessed scale
 * would put every clip in the wrong place, confidently.
 */
const mapReady = computed(() => duration.value > 0);

const publishedLabel = computed(() =>
  publishedClips.value.length === 1
    ? '1 corte ya publicado'
    : `${publishedClips.value.length} cortes ya publicados`,
);

/** Clicking a published clip jumps playback to it. ⚠️ It does NOT move the cut:
 *  these are somebody else's clips and this screen is making a new one. */
function goToBand(band: ClipBand): void {
  seekAudio(band.start);
}

const cutDurationLabel = computed(() => formatClipTime(points.value[2] - points.value[0]));
/** ⚠️ `hh:mm:ss`, not `formatClipTime`'s short form: it sits between the two
 *  edges of the window and above two cut fields, all four of which are
 *  `hh:mm:ss`. At `mm:ss` it was the one number on the row with a different
 *  shape, and it changed width as the episode crossed an hour. */
const currentTimeLabel = computed(() => formatHhmmss(currentTime.value));
const episodeDurationLabel = computed(() => formatClipTime(duration.value));

// ── The two timecodes, which are now typed into ───────────────────────────────
//
// ⚠️ **They were read-only `<b>` elements** until 2026-08-22, in their own row of
// three boxes, while the buttons that moved them lived two blocks below. The
// boxes are gone: each timecode now sits between the four buttons that move it,
// and it can be typed into — which the screen could always have allowed, since
// `hhmmssToSeconds` has always been on this file's hot path.
//
// The refs below are an EDITING BUFFER, not the model. `points` stays the truth;
// these mirror it except while the field they belong to has focus, so a
// half-typed `00:12:0` is not repeatedly reformatted under the cursor.

const startText = ref('00:00:00');
const endText = ref('00:00:00');
/** Which field the cursor is in, or `null`. */
const editing = ref<'start' | 'end' | null>(null);

watch(
  points,
  ([start, , end]) => {
    if (editing.value !== 'start') startText.value = formatHhmmss(start);
    if (editing.value !== 'end') endText.value = formatHhmmss(end);
  },
  { immediate: true },
);

function onTimeInput(point: 'start' | 'end', text: string): void {
  if (point === 'start') startText.value = text;
  else endText.value = text;

  // Not a timecode yet — the visitor is still typing one. Nothing moves, and
  // `cutSeconds` below refuses to publish until it is.
  const seconds = hhmmssToSeconds(text);
  if (seconds !== null) moveCutPoint(point, seconds);
}

/**
 * ⚠️ On the way out the field snaps back to the model, and that IS the feedback:
 * a time the cut could not take (past the other end, outside the episode) or a
 * text that was never a timecode visibly reverts to the number that is really
 * there, instead of sitting on screen disagreeing with the timeline.
 */
function onTimeBlur(): void {
  editing.value = null;
  startText.value = formatHhmmss(points.value[0]);
  endText.value = formatHhmmss(points.value[2]);
}

/**
 * ⚠️ **The published seconds are parsed back out of the displayed timecodes.**
 * This keeps the property that what is published is what was read, without
 * keeping strings, so the row in the database cannot disagree with what the
 * person read off the screen.
 *
 * ⚠️ Now that the timecodes are editable there is a second way for the two to
 * disagree, and it is the reason for the equality check: a value the cut
 * *refused* — `00:99:99` while the episode is an hour long, a start typed past
 * the end — stays in the field until it loses focus, and publishing that number
 * would be publishing something the timeline never showed. `null` disables the
 * button rather than publishing a guess, exactly as it already did for the
 * `--:--:--` an episode with no duration produces.
 */
const cutSeconds = computed<{ start: number; end: number } | null>(() => {
  const start = hhmmssToSeconds(startText.value);
  const end = hhmmssToSeconds(endText.value);
  if (start === null || end === null) return null;
  if (start !== points.value[0] || end !== points.value[2]) return null;
  return { start, end };
});

// ── Publishing ───────────────────────────────────────────────────────────────

async function save(): Promise<void> {
  const current = episode.value;
  const cut = cutSeconds.value;
  if (current === undefined || cut === null) return;

  // ⚠️ Flags are recomputed on every attempt, so a title error clears as soon as
  // the title is typed.
  validation.title = title.value === '';
  validation.tags = tags.value.length === 0;
  if (validation.title || validation.tags) return;

  saving.value = true;
  try {
    const published = await createClip.mutateAsync({
      episodeId: current.id,
      title: title.value,
      tags: tags.value,
      start: cut.start,
      end: cut.end,
    });

    // ⚠️ **The mark survives the cut and remembers what came of it**
    // (2026-08-26). It is the last step of the only path a moment has out of
    // this browser: marked while listening, cut here, published for everybody.
    // The episode page then draws `ya es el corte nº 137` on that row instead of
    // offering to cut the same second again.
    if (seededMomentAt !== null) moments.markAsCut(current.id, seededMomentAt, published.id);

    await router.push({ name: 'episode', params: { title: buildEpisodeUrl(current) } });
  } catch (error) {
    // ⚠️ A 400 is `REQUEST_REJECTED` and its `message` is the backend's own
    // explanation — `end` at or before `start`, a title over 255 characters.
    // Showing "no se ha podido conectar" instead would blame the network for a
    // request that arrived perfectly.
    notifications.push(domainErrorNotice(error));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <main class="editor">
    <template v-if="episode && ready">
      <!-- The episode header: the same one `/episode/:title` carries. -->
      <div class="editor__head">
        <span class="editor__cover" :style="{ backgroundImage: `url(${episode.cover})` }" />
        <div class="editor__headings">
          <h1 class="grav-stage-title editor__title">{{ episode.title }}</h1>
          <!-- ⚠️ `data-test` on the duration: the length lives in this line
               rather than in its own box under the timeline, and the fact it
               states — "the screen knows how long the episode is" — is the
               one the e2e suite pins. -->
          <p class="editor__meta">
            <span data-test="episode-duration">{{ episodeDurationLabel }}</span> ·
            {{ publishedLabel }}
          </p>
        </div>
      </div>

      <div class="grav-panel editor__stage">
        <!-- ── The whole episode, and everything already cut from it ────────
             ⚠️ Informative only. Overlapping is allowed; this exists so it is
             not done by accident. -->
        <div class="ed-map" :class="{ 'is-disabled': !mapReady }">
          <template v-if="mapReady">
            <span
              v-if="mapWindow"
              class="ed-map__window"
              :style="{ left: `${mapWindow.left}%`, width: `${mapWindow.width}%` }"
            />
            <!-- ⚠️ The cut being made goes UNDER the published ones, and the
                 order is the whole point: it opens spanning the episode minus
                 its last ten minutes, so drawn on top it would hide every clip
                 the map exists to show. It is taller at both edges, which is
                 what still reads as the thing in front. -->
            <span
              v-if="mapNewBand"
              class="ed-map__new"
              :style="{ left: `${mapNewBand.left}%`, width: `${mapNewBand.width}%` }"
            />
            <button
              v-for="band of mapBands"
              :key="band.id"
              type="button"
              class="ed-map__clip"
              :style="{ left: `${band.left}%`, width: `${band.width}%` }"
              :title="`Nº ${band.id} · ${band.title}`"
              :aria-label="`Escuchar el corte ${band.title}`"
              @click="goToBand(band)"
            />
          </template>
        </div>

        <!-- ⚠️ The legend does not repeat the numbers the header already carries
             (`publishedLabel`, and the episode's length). It names the colours and
             says what the map can do, which is the one thing nothing else said. -->
        <div class="ed-legend grav-mono">
          <template v-if="mapReady">
            <span><i class="ed-legend__published" />ya publicados</span>
            <span><i class="ed-legend__new" />el tuyo</span>
            <span><i class="ed-legend__window" />lo que ves abajo</span>
            <span class="ed-legend__total">pulsa un corte publicado para escucharlo ahí</span>
          </template>
          <!-- ⚠️ `episode.duration` is nullable and the browser is what supplies
               it: with no scale the map is drawn empty rather than guessing. -->
          <span v-else>midiendo el episodio…</span>
        </div>

        <!-- ── The zoomed timeline ─────────────────────────────────────── -->
        <div class="ed-track">
          <!-- ⚠️ Measured for the zoomed window when the waveform query has
               answered (debounced — see `WAVEFORM_ZOOM_DEBOUNCE_MS` above),
               falling back to `GravWave`'s drawn placeholder — seeded by the
               episode, so it is stable across renders — for an episode that
               has not been measured yet or while the request is in flight. -->
          <GravWave
            class="ed-track__wave"
            :progress="0"
            :seed="episodeId"
            :bars="160"
            :peaks="waveform.data.value?.peaks"
          />

          <span
            v-for="band of trackBands"
            :key="band.id"
            class="ed-existing"
            :style="{ left: `${band.left}%`, width: `${band.width}%` }"
            :title="`Nº ${band.id} · ${band.title}`"
          >
            <span class="grav-mono">Nº {{ band.id }} · {{ band.title }}</span>
          </span>

          <ThreeHandleSlider
            class="editor__timeline"
            :model-value="points"
            :min="zoom.min"
            :max="zoom.max"
            :step="1"
            @update:model-value="onTimelineInput"
            @drag-start="onDragStart"
            @drag-end="onDragEnd"
          />
        </div>

        <!-- ⚠️ The window's two edges, and BETWEEN THEM THE CLOCK — which
             until 2026-08-22 was 0,66 rem of faint grey buried in the middle of
             a sentence ("00:00 · zoom 01:18:43 de 01:18:43"), i.e. the smallest
             text on a screen whose whole job is that number. The "zoom X de Y"
             is gone with it: it stated the episode's length for the third time
             on one screen. -->
        <div class="ed-scale grav-mono">
          <span>{{ formatHhmmss(zoom.min) }}</span>
          <b data-test="current-time">{{ currentTimeLabel }}</b>
          <span>{{ formatHhmmss(zoom.max) }}</span>
        </div>

        <!-- ⚠️ Pinned to what it explains. It used to close the row of buttons,
             where it was doing duty as filler for the tail of a flex-wrap. -->
        <p class="ed-hint ed-track-hint">
          Las asas no se cruzan: inicio ≤ reproducción ≤ fin, siempre.
        </p>

        <!-- ── The two ends of the cut ─────────────────────────────────────
             ⚠️ **Each number lives between the four buttons that move it.**
             Until 2026-08-22 the three timecodes were read-only boxes stretched
             across the panel and the buttons that changed them sat two blocks
             lower, in a four-column grid whose columns did not fit their
             contents. `−10 −1 [tiempo] +1 +10`: the two side tracks are fixed
             and symmetric, so both ends measure exactly the same and the number
             is genuinely centred between them. -->
        <div class="ed-ends">
          <div class="ed-end">
            <label class="grav-rail-heading" for="editor-start">Inicio</label>
            <button
              v-for="delta of NUDGE_DELTAS.slice(0, 2)"
              :key="delta"
              type="button"
              class="ed-step"
              :class="{ 'ed-step--big': Math.abs(delta) === 10 }"
              :aria-label="`Adelantar el inicio ${Math.abs(delta)} segundos`"
              @click="nudgeCutPoint('start', delta)"
            >
              {{ delta }}
            </button>
            <input
              id="editor-start"
              class="ed-time"
              data-test="cut-start"
              type="text"
              inputmode="numeric"
              spellcheck="false"
              autocomplete="off"
              :value="startText"
              aria-label="Inicio del corte"
              @focus="editing = 'start'"
              @blur="onTimeBlur"
              @input="onTimeInput('start', ($event.target as HTMLInputElement).value)"
            />
            <button
              v-for="delta of NUDGE_DELTAS.slice(2)"
              :key="delta"
              type="button"
              class="ed-step"
              :class="{ 'ed-step--big': Math.abs(delta) === 10 }"
              :aria-label="`Retrasar el inicio ${delta} segundos`"
              @click="nudgeCutPoint('start', delta)"
            >
              +{{ delta }}
            </button>
            <!-- ⚠️ "Al punto actual", promoted. It is the verb this
                 screen is really about — you listen, and you say "here" — and it
                 keeps its label, which says WHICH end it marks; the
                 visible text sits under its own heading and cannot. -->
            <button
              type="button"
              class="ed-mark"
              aria-label="Mover el inicio al punto actual"
              @click="moveCutPointToPlayhead('start')"
            >
              [ marcar aquí el inicio
            </button>
          </div>

          <div class="ed-dur">
            <span>Dura</span>
            <b data-test="cut-duration">{{ cutDurationLabel }}</b>
          </div>

          <div class="ed-end">
            <label class="grav-rail-heading" for="editor-end">Fin</label>
            <button
              v-for="delta of NUDGE_DELTAS.slice(0, 2)"
              :key="delta"
              type="button"
              class="ed-step"
              :class="{ 'ed-step--big': Math.abs(delta) === 10 }"
              :aria-label="`Adelantar el final ${Math.abs(delta)} segundos`"
              @click="nudgeCutPoint('end', delta)"
            >
              {{ delta }}
            </button>
            <input
              id="editor-end"
              class="ed-time"
              data-test="cut-end"
              type="text"
              inputmode="numeric"
              spellcheck="false"
              autocomplete="off"
              :value="endText"
              aria-label="Fin del corte"
              @focus="editing = 'end'"
              @blur="onTimeBlur"
              @input="onTimeInput('end', ($event.target as HTMLInputElement).value)"
            />
            <button
              v-for="delta of NUDGE_DELTAS.slice(2)"
              :key="delta"
              type="button"
              class="ed-step"
              :class="{ 'ed-step--big': Math.abs(delta) === 10 }"
              :aria-label="`Retrasar el final ${delta} segundos`"
              @click="nudgeCutPoint('end', delta)"
            >
              +{{ delta }}
            </button>
            <button
              type="button"
              class="ed-mark"
              aria-label="Mover el final al punto actual"
              @click="moveCutPointToPlayhead('end')"
            >
              marcar aquí el fin ]
            </button>
          </div>
        </div>

        <!-- ── One bar, three rows ──────────────────────────────────────
             ⚠️ **The rows are explicit, and they are the SAME three on both
             layouts.** They used to be whatever `flex-wrap` produced, which on a
             phone was five ragged lines; each row is now a container that
             `display: contents` flattens back into one line on a wide screen, so
             there is one DOM and neither layout is emergent.

             The rows are grouped by what they move: what sounds · where the
             playback is · what is on screen. ⚠️ That is why "ir a" is gone as a
             group of its own — its two jumps move the playhead exactly like the
             four seeks do, so they are the bookends of that row now, and the bar
             lost a label without losing a control. -->
        <div class="ed-bar">
          <div class="ed-bar__row">
            <button
              type="button"
              class="ed-primary"
              :aria-label="playing ? 'Pausar' : 'Reproducir'"
              @click="togglePlay"
            >
              <v-icon :icon="playing ? 'mdi-pause' : 'mdi-play'" size="14" aria-hidden="true" />
              {{ playing ? 'Pausar' : 'Escuchar el corte' }}
            </button>

            <!-- ⚠️ Was a `<v-slider>`, the only control on this screen not built
                 out of the site's own tokens, offering half-steps up to x4. It
                 sits beside the play button because speed is part of what
                 sounds, not part of what is looked at. -->
            <div class="ed-group">
              <span class="ed-group__label">vel</span>
              <div class="ed-seg" role="group" aria-label="Velocidad de reproducción">
                <button
                  v-for="rate of PLAYBACK_RATES"
                  :key="rate"
                  type="button"
                  :aria-pressed="playbackRate === rate"
                  :aria-label="`Velocidad x${rate}`"
                  @click="playbackRate = rate"
                >
                  {{ rate }}
                </button>
              </div>
            </div>
          </div>

          <!-- ⚠️ Symmetric since 2026-08-22: it was `−1 min · −10 s · +30 s`,
               with no `+1 min` and no way back of
               thirty. -->
          <div class="ed-bar__row">
            <div class="ed-group">
              <span class="ed-group__label">recorrer</span>
              <button
                type="button"
                class="ed-chip ed-chip--icon"
                aria-label="Ir al inicio del corte"
                title="Al inicio del corte"
                @click="seekToCutStart"
              >
                <v-icon icon="mdi-skip-backward" size="15" aria-hidden="true" />
              </button>
              <button
                type="button"
                class="ed-chip"
                aria-label="Retrocede 1 minuto"
                @click="scheduleRelativeSeek(-60)"
              >
                −1 min
              </button>
              <button
                type="button"
                class="ed-chip"
                aria-label="Retrocede 10 segundos"
                @click="scheduleRelativeSeek(-10)"
              >
                −10 s
              </button>
              <button
                type="button"
                class="ed-chip"
                aria-label="Avanza 10 segundos"
                @click="scheduleRelativeSeek(10)"
              >
                +10 s
              </button>
              <button
                type="button"
                class="ed-chip"
                aria-label="Avanza 1 minuto"
                @click="scheduleRelativeSeek(60)"
              >
                +1 min
              </button>
              <button
                type="button"
                class="ed-chip ed-chip--icon"
                aria-label="Ir al 5 segundos antes del final del corte"
                title="Al final del corte"
                @click="seekToCutEnd"
              >
                <v-icon icon="mdi-skip-forward" size="15" aria-hidden="true" />
              </button>
              <span v-if="waiting" class="ed-hint grav-mono">buscando…</span>
            </div>
          </div>

          <span class="ed-bar__gap" />

          <div class="ed-bar__row">
            <div class="ed-group">
              <span class="ed-group__label">zoom</span>
              <!-- ⚠️ `+` and `−` are icons and the two ABSOLUTE jumps keep their
                   words. Four magnifiers side by side at 15 px are not tellable
                   apart, and these two are the pair nobody can guess from a
                   glyph — the relative pair everybody can. -->
              <button
                type="button"
                class="ed-chip ed-chip--icon"
                aria-label="Acercar el zoom"
                title="Acercar"
                @click="zoomIn"
              >
                <v-icon icon="mdi-magnify-plus-outline" size="15" aria-hidden="true" />
              </button>
              <button
                type="button"
                class="ed-chip ed-chip--icon"
                aria-label="Retrocede el zoom"
                title="Alejar"
                @click="zoomOut"
              >
                <v-icon icon="mdi-magnify-minus-outline" size="15" aria-hidden="true" />
              </button>
              <button
                type="button"
                class="ed-chip"
                aria-label="Hacer zoom a la sección delimitada"
                @click="zoomToCut"
              >
                al corte
              </button>
              <button type="button" class="ed-chip" aria-label="Reiniciar zoom" @click="zoomReset">
                todo
              </button>
            </div>
          </div>
        </div>

        <!-- ⚠️ The keyboard has moved the handles and no
             screen ever said so. The two sizes it offers are exactly the two the
             buttons above offer, which is why neither needs a control to pick
             between them. -->
        <p class="ed-hint ed-keys">
          <kbd>←</kbd> <kbd>→</kbd> mueven el asa seleccionada 1 s, con <kbd>Shift</kbd> diez.
        </p>
      </div>

      <!-- ── The form ─────────────────────────────────────────────────── -->
      <div class="ed-form">
        <div>
          <!-- ⚠️ Both fields have always been required and neither said so until
               the button had been pressed and answered with two red lines at
               once. The marker is the announcement; the messages below stay,
               because they are the only thing that says WHICH one is missing.
               ⚠️ The button is deliberately NOT disabled while they are empty —
               a primary action that is off and cannot say why is a dead end, and
               turning it off would make those messages unreachable. -->
          <label class="grav-rail-heading" for="editor-title">
            Título del corte <span class="ed-required">· obligatorio</span>
          </label>
          <label class="grav-field">
            <input
              id="editor-title"
              v-model="title"
              type="text"
              required
              :aria-invalid="validation.title ? 'true' : undefined"
              placeholder="Ponle un título… (así se busca luego)"
            />
          </label>
          <p v-if="validation.title" class="ed-error">Introduce un título para el corte.</p>
        </div>

        <div>
          <label class="grav-rail-heading" for="editor-tags">
            Tags <span class="ed-required">· al menos uno</span>
          </label>
          <!-- ⚠️ `TagPicker`, not the `v-combobox` this screen used until
               2026-08-22: that one's menu is a Vuetify overlay painted on
               `surface`, which in this theme is WHITE, and it teleports itself
               to `<body>` — outside the `.control-graviner` wrapper that paints
               the field, so the field could be styled and the menu could not.
               This one has no overlay at all. -->
          <TagPicker input-id="editor-tags" v-model="tags" aria-label="Añade un tag al corte" />
          <p v-if="validation.tags" class="ed-error">Introduce al menos un tag.</p>
        </div>

        <div class="ed-submit">
          <button
            type="button"
            class="ed-publish"
            :disabled="saving || cutSeconds === null"
            @click="save"
          >
            {{ saving ? 'Publicando…' : 'Publicar corte' }}
          </button>
          <span class="ed-hint">
            Sin cuenta y sin registro: se publica al momento y aparece el primero en «añadidos
            recientemente».
          </span>
        </div>
      </div>
    </template>

    <!-- No error branch: every failure navigates away (see the watchers), and
         until `canplay` there is genuinely nothing to draw. -->
    <p v-else class="editor__loading grav-mono">cargando el episodio…</p>
  </main>
</template>

<style scoped>
.editor {
  padding: 1.1rem;
  max-width: 1100px;
  margin: 0 auto;
}

.editor__head {
  display: flex;
  gap: 0.9rem;
  align-items: center;
  padding-bottom: 0.8rem;
  margin-bottom: 0.9rem;
  border-bottom: 1px solid rgb(220 192 142 / 0.16);
}

.editor__cover {
  flex: 0 0 auto;
  width: 64px;
  height: 64px;
  border-radius: 2px;
  background-color: var(--grav-stage-panel);
  background-size: cover;
  background-position: center;
}

.editor__headings {
  min-width: 0;
}

.editor__title {
  font-size: 1.7rem;
  overflow-wrap: anywhere;
}

.editor__meta {
  margin: 0.18rem 0 0;
  font-size: 0.78rem;
  color: var(--grav-stage-ink-muted);
}

.editor__loading {
  padding: 3rem 0;
  text-align: center;
  font-size: 0.75rem;
  color: var(--grav-stage-ink-faint);
}

/* ── The episode map ────────────────────────────────────────────────────── */
.ed-map {
  position: relative;
  height: 26px;
  border-radius: 3px;
  background: var(--grav-stage-panel-deep);
  border: 1px solid rgb(220 192 142 / 0.14);
  margin-bottom: 0.6rem;
  overflow: hidden;
}

.ed-map.is-disabled {
  opacity: 0.5;
}

.ed-map__clip {
  position: absolute;
  top: 4px;
  bottom: 4px;
  background: rgb(220 192 142 / 0.55);
  border-radius: 2px;
  cursor: pointer;
}

.ed-map__clip:hover,
.ed-map__clip:focus-visible {
  background: var(--grav-brown);
}

.ed-map__new {
  position: absolute;
  top: 2px;
  bottom: 2px;
  background: rgb(var(--v-theme-primary));
  border-radius: 2px;
  pointer-events: none;
}

.ed-map__window {
  position: absolute;
  top: -1px;
  bottom: -1px;
  border: 1px solid var(--grav-brown);
  border-radius: 3px;
  background: rgb(220 192 142 / 0.08);
  pointer-events: none;
}

.ed-legend {
  display: flex;
  gap: 1.1rem;
  flex-wrap: wrap;
  font-size: 0.66rem;
  color: var(--grav-stage-ink-faint);
  margin-bottom: 0.9rem;
}

.ed-legend i {
  display: inline-block;
  width: 18px;
  height: 8px;
  border-radius: 2px;
  margin-right: 0.35rem;
  vertical-align: middle;
}

.ed-legend__published {
  background: rgb(220 192 142 / 0.55);
}

.ed-legend__new {
  background: rgb(var(--v-theme-primary));
}

.ed-legend__window {
  background: rgb(220 192 142 / 0.08);
  border: 1px solid var(--grav-brown);
}

.ed-legend__total {
  margin-left: auto;
}

/* ── The zoomed track ───────────────────────────────────────────────────── */
/*
 * ⚠️ **Three numbers that must agree, so they are one set of variables.** The
 * waveform is drawn behind the slider and the dashed boxes over it, and both are
 * positioned by hand against the slider's own padding — "a bar halfway along the
 * waveform really is halfway along the window" only holds while they match. They
 * were three literals in three rules, and the narrow layout broke the agreement
 * the moment it changed the slider's padding: the wave ended up 11 px low and
 * 6 px in from the track. Now the narrow block overrides the variables and
 * everything derived from them follows.
 */
.ed-track {
  position: relative;
  padding: 0.3rem 0 0.2rem;

  --ed-slider-pad-y: 2.5rem;
  --ed-slider-pad-x: 1.5rem;
  --ed-wave-h: 78px;
  --ed-handle-h: 90px;
}

/* ⚠️ Behind everything, and `pointer-events: none`: the slider's own track is
   what takes the press, and a decoration swallowing a drag would be maddening.
   Inset to the slider's own horizontal padding, so a bar halfway along the
   waveform really is halfway along the window. */
.ed-track__wave {
  position: absolute;
  left: var(--ed-slider-pad-x);
  right: var(--ed-slider-pad-x);
  top: calc(0.3rem + var(--ed-slider-pad-y));
  height: var(--ed-wave-h);
  pointer-events: none;
  --grav-wave-idle: #3a3735;
  --grav-wave-played: #3a3735;
}

/*
 * ⚠️ **The slider is re-skinned through its OWN four variables**, not by
 * reaching into its internals. `ThreeHandleSlider` declares `--ths-rail`,
 * `--ths-fill`, `--ths-handle` and `--ths-playhead` at the top of its scoped
 * block precisely so a screen can repaint it, and its behaviour — the clamp, the
 * collision tie-break, zooming without a remount — is untouched, along with its
 * tests.
 *
 * The design's timeline: the waveform behind, the selection in red between three
 * handles, the playhead a thin brown bar.
 */
.editor__timeline {
  position: relative;
  --ths-rail: transparent;
  --ths-fill: rgba(var(--v-theme-primary), 0.3);
  --ths-handle: rgb(var(--v-theme-primary));
  --ths-playhead: var(--grav-brown);
}

/* The `:deep()` blocks below are geometry, which no variable expresses: a 78 px
   track, and handles tall enough to grab beside it. */
.editor__timeline {
  padding: var(--ed-slider-pad-y) var(--ed-slider-pad-x);
}

.editor__timeline :deep(.ths__track) {
  height: var(--ed-wave-h);
}

.editor__timeline :deep(.ths__connect) {
  border-top: 1px solid rgb(var(--v-theme-primary));
  border-bottom: 1px solid rgb(var(--v-theme-primary));
}

.editor__timeline :deep(.ths__handle) {
  width: 14px;
  height: var(--ed-handle-h);
  border-radius: 3px;
  border: 0;
  box-shadow: 0 2px 5px rgb(0 0 0 / 0.5);
}

.editor__timeline :deep(.ths__handle--playhead) {
  width: 4px;
  height: 98px;
  border-radius: 2px;
}

.editor__timeline :deep(.ths__tooltip) {
  background: var(--grav-stage-panel-deep);
  color: var(--grav-brown);
  font-family: var(--grav-font-mono);
}

/* ⚠️ Over the waveform but under the handles, and `pointer-events: none` on
   purpose: the handles are what the pointer is for here, and a dashed box
   swallowing a drag that started over it would be maddening. The title is a
   `title` attribute, which is why it is still readable on hover. */
.ed-existing {
  position: absolute;
  left: var(--ed-slider-pad-x);
  top: calc(0.3rem + var(--ed-slider-pad-y));
  height: var(--ed-wave-h);
  background: rgb(220 192 142 / 0.14);
  border: 1px dashed rgb(220 192 142 / 0.5);
  border-radius: 3px;
  overflow: hidden;
  pointer-events: none;
}

.ed-existing span {
  position: absolute;
  left: 6px;
  top: 4px;
  font-size: 0.64rem;
  color: var(--grav-brown);
  white-space: nowrap;
}

/* ── The scale, with the clock in the middle ────────────────────────────── */
.ed-scale {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-top: 0.75rem;
  font-size: 0.66rem;
  color: var(--grav-stage-ink-faint);
}

/* ⚠️ 1.35 rem against the 0.66 rem beside it. This is the number the screen is
   for, and it used to be set at the same size as the window's edges. */
.ed-scale b {
  font-size: 1.35rem;
  font-weight: 500;
  color: var(--grav-brown);
}

.ed-track-hint {
  margin: 0.45rem 0 0;
}

/* ── The two ends of the cut ────────────────────────────────────────────── */
.ed-ends {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 1rem;
  align-items: stretch;
  margin: 1rem 0 1.1rem;
}

/*
 * ⚠️ **Five tracks, and the two on each side are FIXED.** With `auto` the two
 * ends would size to their own content — `−10` and `+10` are not the same width
 * in a proportional face, and neither are the two headings — so the two
 * timecodes would sit at different x and the panel would read as lopsided. Fixed
 * side tracks make both ends measure the same and put each number genuinely in
 * the middle of the four buttons that move it.
 */
/*
 * ⚠️ **Five tracks, all bounded, centred with `justify-content`.** Both ends
 * therefore measure the same whatever the panel is doing, and the number sits
 * genuinely in the middle of its four buttons. Stretched across half of an
 * 1100 px panel, an eight-character timecode sat in a field four times wider
 * than its content and the buttons drifted to the far edges of the screen.
 *
 * ⚠️ **Centring is `justify-content`, NOT a `1fr` spacer track at each end.**
 * Grid auto-placement fills tracks in source order, so seven tracks want seven
 * children: with five, the first spacer swallowed `−10` and the `+1` button
 * inherited the wide middle track — the timecode rendered two characters wide
 * beside a button four times its size. Same trap `ClipRowItem` documents from
 * the other direction, where the answer was an inert element to hold the track
 * open; here there is nothing to hold open, so the tracks simply go.
 */
.ed-end {
  display: grid;
  grid-template-columns: 2.7rem 2.3rem minmax(6rem, 11rem) 2.3rem 2.7rem;
  justify-content: center;
  gap: 0.3rem;
  align-items: center;
}

.ed-end > .grav-rail-heading {
  grid-column: 1 / -1;
  margin: 0 0 0.15rem;
}

.ed-step {
  font-family: var(--grav-font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 0.78rem;
  line-height: 1;
  height: 2.1rem;
  color: #d9d4cd;
  border: 1px solid var(--grav-hairline-strong);
  border-radius: 4px;
  cursor: pointer;
}

.ed-step:hover,
.ed-step:focus-visible {
  border-color: var(--grav-brown);
  color: var(--grav-brown);
}

/* The ten-second jump reads a step quieter than the one-second one: the fine
   adjustment is the one used last, and the one worth having forward. */
.ed-step--big {
  color: var(--grav-stage-ink-faint);
}

/* ⚠️ An `<input>`, not the `<b>` it was until 2026-08-22. `text-align: center`
   is not decoration — the number sits between two pairs of buttons and reads as
   theirs only if it is centred between them. */
.ed-time {
  width: 100%;
  min-width: 0;
  background: var(--grav-field-bg);
  border: 1px solid var(--grav-field-border);
  border-radius: 4px;
  padding: 0.34rem 0.4rem;
  font-family: var(--grav-font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 1.08rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  text-align: center;
  color: var(--grav-stage-ink);
  text-shadow: var(--grav-field-shadow);
  outline: none;
}

.ed-time:focus {
  border-color: var(--grav-brown);
}

.ed-mark {
  grid-column: 1 / -1;
  margin-top: 0.35rem;
  font-size: 0.76rem;
  color: var(--grav-brown);
  border: 1px dashed var(--grav-hairline-strong);
  border-radius: 4px;
  padding: 0.3rem 0.5rem;
  cursor: pointer;
}

.ed-mark:hover,
.ed-mark:focus-visible {
  border-style: solid;
  background: rgb(220 192 142 / 0.07);
}

.ed-dur {
  display: grid;
  place-items: center;
  align-content: center;
  padding: 0 1rem;
  text-align: center;
  border-left: 1px solid var(--grav-hairline);
  border-right: 1px solid var(--grav-hairline);
}

.ed-dur span {
  font-size: 0.62rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--grav-brown);
}

.ed-dur b {
  font-family: var(--grav-font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 1.3rem;
  font-weight: 500;
  color: var(--grav-stage-ink);
}

/* ── The one bar ────────────────────────────────────────────────────────── */
.ed-bar {
  display: flex;
  align-items: center;
  /* ⚠️ Three times `.ed-group`'s own 0.28rem. That ratio IS the grouping now
     that the outlines are gone; closing it would run all four sections into one
     undifferentiated row of pills. */
  gap: 0.9rem;
  flex-wrap: wrap;
  padding-top: 0.9rem;
  border-top: 1px solid rgb(220 192 142 / 0.14);
}

/*
 * ⚠️ **Grouped by proximity, not by an outline.** The bar's own `gap` is three
 * times the gap inside a group, which is what separates "recorrer" from "zoom"
 * without drawing boxes across a panel that already has a border of its own.
 * The label is what names each group; the spacing is what bounds it.
 */
.ed-group {
  display: flex;
  align-items: center;
  gap: 0.28rem;
}

/*
 * ⚠️ **`display: contents` is the whole trick, and it is what lets one DOM serve
 * both layouts.** Wide, the three rows dissolve and their groups become direct
 * children of `.ed-bar`, so the bar is one line with `.ed-bar__gap` pushing zoom
 * to the right exactly as before. Narrow (below), they become real rows and the
 * bar stacks. Neither layout is left to `flex-wrap` to guess at.
 */
.ed-bar__row {
  display: contents;
}

.ed-group__label {
  font-family: var(--grav-font-mono);
  font-size: 0.6rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--grav-stage-ink-faint);
  padding: 0 0.3rem 0 0.45rem;
}

/* Sound on the left, looking on the right — and the whole slack between them
   when the row is wide enough to have any. */
.ed-bar__gap {
  flex: 1 1 auto;
  min-width: 0.5rem;
}

.ed-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-family: var(--grav-font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 0.75rem;
  color: #d9d4cd;
  border: 1px solid var(--grav-hairline-strong);
  border-radius: 20px;
  padding: 0.15rem 0.55rem;
  cursor: pointer;
  white-space: nowrap;
}

.ed-chip--icon {
  padding: 0.15rem 0.4rem;
}

.ed-chip:hover,
.ed-chip:focus-visible {
  border-color: var(--grav-brown);
  color: var(--grav-brown);
}

.ed-seg {
  display: inline-flex;
  border: 1px solid var(--grav-hairline-strong);
  border-radius: 4px;
  overflow: hidden;
}

.ed-seg button {
  padding: 0.22rem 0.5rem;
  font-family: var(--grav-font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 0.74rem;
  color: #cfc9c1;
  border-right: 1px solid var(--grav-hairline);
  cursor: pointer;
}

.ed-seg button:last-child {
  border-right: 0;
}

.ed-seg button:hover {
  color: var(--grav-brown);
}

.ed-seg button[aria-pressed='true'] {
  background: rgb(220 192 142 / 0.16);
  color: var(--grav-brown);
}

/*
 * ⚠️ **One width for both states.** It says "Escuchar el corte" and then
 * "Pausar", and sized to its content it shrank by half the moment playback
 * started — taking the whole bar beside it leftwards, mid-listen, every time.
 * That is the same rule `ClipRowItem` keeps for its queue button and its action
 * tracks: nothing may change size because its state changed.
 *
 * ⚠️ The width is the WIDER label's, **measured in a browser** rather than
 * reasoned about — "Escuchar el corte" needs 143,6 px with its icon, its gap and
 * its padding, against 82,6 px for "Pausar". Rounded up to leave a few pixels
 * for a different hinting, and the content centred in it. If either label
 * changes, measure again: `white-space: nowrap` means a label that outgrows this
 * overflows rather than wrapping, which is silent.
 */
.ed-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  width: 9.4rem;
  font-size: 0.82rem;
  font-weight: 600;
  background: rgb(var(--v-theme-primary));
  color: var(--grav-stage-ink);
  border-radius: 3px;
  padding: 0.32rem 0.72rem;
  cursor: pointer;
  white-space: nowrap;
}

.ed-hint {
  font-size: 0.78rem;
  color: var(--grav-stage-ink-faint);
}

.ed-keys {
  margin: 0.6rem 0 0;
}

.ed-keys kbd {
  font-family: var(--grav-font-mono);
  font-size: 0.66rem;
  color: var(--grav-stage-ink-faint);
  border: 1px solid var(--grav-hairline);
  border-radius: 3px;
  padding: 0.05rem 0.32rem;
}

/* ── The form ───────────────────────────────────────────────────────────── */
.ed-form {
  display: grid;
  gap: 0.8rem;
  margin-top: 1rem;
}

.ed-form .grav-field {
  font-size: 1rem;
  padding: 0.5rem 0.7rem;
}

.ed-form .grav-field input {
  color: var(--grav-stage-ink);
}

/* ⚠️ Not red, and not an asterisk. Both fields are required, so marking them
   in the error colour would paint the form as broken before it has been
   touched; this is a label, and it reads as one. */
.ed-required {
  font-weight: 500;
  letter-spacing: 0.08em;
  color: var(--grav-stage-ink-faint);
}

.ed-error {
  margin: 0.35rem 0 0;
  font-size: 0.8rem;
  color: rgb(var(--v-theme-error));
}

.ed-submit {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-top: 0.4rem;
}

.ed-publish {
  font-family: var(--grav-font-title);
  font-size: 1.4rem;
  text-transform: uppercase;
  background: rgb(var(--v-theme-primary));
  color: var(--grav-stage-ink);
  padding: 0.35rem 1.1rem;
  border-radius: 3px;
  cursor: pointer;
}

.ed-publish:disabled {
  opacity: 0.5;
  cursor: default;
}

/* ══════════════════════════════════════════════════════════════════════════
 * NARROW — the phone layout, measured on a 390 × 844 (2026-08-22).
 *
 * ⚠️ **The number that mattered was not the total, it was where the fold fell.**
 * The whole screen came to 1769 px against 707 usable (844 minus the 56 px
 * header and the 81 px `App.vue` reserves for the fixed player), and the fold
 * landed INSIDE the Inicio/Dura/Fin block — so every button that moves the cut
 * was below it. Cutting meant dragging a handle, scrolling down to nudge, and
 * scrolling back up to see what happened.
 *
 * The cutting half is 646 px here, which fits with about 60 px to spare. That is
 * not a lot: a narrower phone or a longer episode title eats it. If it turns out
 * not to be enough in the hand, the next move is splitting the screen in two
 * steps — cut, then publish — not shaving another ten pixels off this.
 * ══════════════════════════════════════════════════════════════════════════ */
@media (max-width: 720px) {
  .editor {
    padding: 0.6rem 0.7rem;
  }

  .editor__stage {
    padding: 0.6rem;
  }

  .ed-map {
    height: 18px;
  }

  /* ⚠️ The cover is hidden, not removed: 64 px of artwork that says nothing the
     title does not, and in a vertical layout those 64 px push the timeline off
     the screen. `aria-hidden` already; nothing is lost to a reader. */
  .editor__cover {
    display: none;
  }

  .editor__head {
    gap: 0;
    padding-bottom: 0.5rem;
    margin-bottom: 0.6rem;
  }

  /*
   * ⚠️ **Two lines, clamped.** The longest title in the catalogue is 79
   * characters ("Episodio 134 (Famoseo variado, Arturo Gonzalez Campos y la
   * oportunidad perdida)") and it takes three lines here — thirty pixels that
   * pushed the last row of the transport bar back under the fold, which is the
   * exact failure this whole layout exists to fix. Most titles are around forty
   * characters and are unaffected; the full one is one tap away on the episode
   * page, and this screen's job is cutting, not reading.
   */
  .editor__title {
    font-size: 1.25rem;
    /* ⚠️ A `max-height`, not `-webkit-line-clamp`: Chrome's newer standard
       `line-clamp` computes `display` to `flow-root` and the clamp silently did
       nothing — the title still measured three lines with `webkitLineClamp`
       reporting "2". Two line-heights is unambiguous, and it works the same
       everywhere. */
    line-height: 1.15;
    max-height: 2.3em;
    overflow: hidden;
  }

  /* One line, and the "click a published clip" hint goes: on a phone that is
     discovered by touching one, and it was costing a whole second line. */
  .ed-legend {
    gap: 0.7rem;
    font-size: 0.6rem;
    margin-bottom: 0.5rem;
  }

  .ed-scale {
    margin-top: 0.5rem;
  }

  .ed-scale b {
    font-size: 1.2rem;
  }

  .ed-legend__total {
    display: none;
  }

  /* ⚠️ Shorter track, WIDER handles — the opposite trade to the desktop, where
     there is height to spare and a mouse is precise. A thumb needs something to
     grab; the screen needs the pixels back. */
  /* ⚠️ The four numbers move together — see `.ed-track` above for why they have
     to. 36 px of the tooltip gutter come back here, which is what the narrow
     layout was short by. */
  .ed-track {
    --ed-slider-pad-y: 1.2rem;
    --ed-slider-pad-x: 1.1rem;
    --ed-wave-h: 60px;
    --ed-handle-h: 72px;
  }

  .editor__timeline :deep(.ths__handle) {
    width: 18px;
  }

  .editor__timeline :deep(.ths__handle--playhead) {
    width: 5px;
    height: 78px;
  }

  /*
   * ⚠️ **36 px back from the tooltip gutter.** `ThreeHandleSlider` reserves
   * `2.5rem` above and below so a label never gets clipped by the card — written
   * when the three labels were on screen permanently. They are not any more
   * (they show while a handle is dragged, hovered or focused), so on a phone the
   * gutter buys nothing at rest and costs 80 px of the 707 there are. Halved: a
   * tooltip raised mid-drag now draws over the episode map above it, which is
   * both harmless and useful — a thumb covers the handle, and that number is
   * what it is covering.
   */
  /* ── The two ends, side by side ─────────────────────────────────────────
   * ⚠️ **The single biggest saving: 291 px → 168.** Stacked, the desktop's
   * `1fr auto 1fr` became three blocks — Inicio, Dura, Fin — each with its own
   * "marcar" button. Two columns instead, with the four step buttons UNDER the
   * number rather than either side of it, which is the only thing that fits in
   * a 170 px column. "Dura" leaves the row for a line of its own beneath. */
  /* ⚠️ `.ed-dur` sits BETWEEN the two ends in the DOM, which is what the wide
     layout wants. In two columns that put it on a row of its own between them,
     so the two ends landed on separate rows and the block came out at 335 px —
     the two-column layout drawn as one column, plus a divider. Ordering it last
     is what actually puts Inicio and Fin side by side. Measured, twice. */
  .ed-ends {
    grid-template-columns: 1fr 1fr;
    gap: 0.4rem 0.5rem;
    margin: 0.45rem 0 0;
  }

  .ed-end {
    order: 0;
  }

  /*
   * ⚠️ **`order` is doing the work, and without it this is worse than what it
   * replaced.** The source order is `heading · −10 · −1 · [tiempo] · +1 · +10 ·
   * marcar`, which is what the wide layout wants. Dropped into four columns
   * unchanged, the two leading buttons take tracks 1–2, the full-width timecode
   * is forced onto a row of its own, the other two take tracks 1–2 of a third,
   * and the block came out at **427 px** — half again as tall as the stacked
   * version this was meant to shrink. Measured, not reasoned about.
   *
   * Re-ordering puts the number above its four buttons, which is the only shape
   * that fits a 170 px column, and gets the block to one heading row, one
   * number row, one button row and one "marcar" row.
   */
  .ed-end {
    grid-template-columns: repeat(4, 1fr);
    justify-content: stretch;
    gap: 0.25rem;
  }

  .ed-end > .grav-rail-heading {
    order: 0;
    margin: 0;
    font-size: 0.62rem;
  }

  .ed-time {
    order: 1;
    grid-column: 1 / -1;
    font-size: 1.05rem;
    padding: 0.3rem 0.2rem;
  }

  /* ⚠️ 42 px, not the desktop's 2.1 rem (33,6). The comfortable minimum for a
     finger is 44 and these were well under it — the whole reason the screen was
     hard to use rather than merely tall. */
  .ed-step {
    order: 2;
    height: 42px;
    font-size: 0.78rem;
  }

  .ed-mark {
    order: 3;
    margin-top: 0;
    height: 34px;
    font-size: 0.75rem;
    padding: 0 0.3rem;
  }

  .ed-dur {
    order: 1;
    grid-column: 1 / -1;
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.5rem 0 0;
    border: 0;
  }

  .ed-dur b {
    font-size: 1rem;
  }

  /* ── The bar: three real rows ───────────────────────────────────────────
   * ⚠️ 204 px → 148, and every target 42 px. Five ragged wrapped lines became
   * three deliberate ones — `display: contents` is off here, so each
   * `.ed-bar__row` is a row for real. */
  .ed-bar {
    flex-direction: column;
    align-items: stretch;
    gap: 0.3rem;
    padding-top: 0.45rem;
    margin-top: 0.45rem;
  }

  .ed-bar__row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .ed-bar__gap {
    display: none;
  }

  .ed-bar__row .ed-group {
    flex: 1 1 auto;
    min-width: 0;
    gap: 0.2rem;
  }

  /* ⚠️ `width: auto` overrides the desktop's measured fixed width. It has to:
     that number was measured at the desktop type size, and here the button
     grows to fill its row instead — which keeps the "one width for both states"
     rule for free, since the row does not change when the label does. */
  .ed-primary {
    flex: 1 1 auto;
    width: auto;
    height: 42px;
    font-size: 0.86rem;
  }

  /* ⚠️ Measured: with the wide layout's 0.75rem type and 0.55rem padding the
     seek row overflowed its own screen by 7 px. Six controls and a label do fit
     in 349 px, but only just, and only at these numbers. */
  .ed-chip {
    height: 42px;
    flex: 1 1 auto;
    justify-content: center;
    font-size: 0.72rem;
    padding: 0 0.3rem;
  }

  .ed-chip--icon {
    flex: 0 0 42px;
    padding: 0;
  }

  .ed-seg {
    height: 42px;
  }

  .ed-seg button {
    padding: 0 0.45rem;
  }

  .ed-group__label {
    width: 2.4rem;
    flex: 0 0 auto;
    padding: 0 0.15rem 0 0;
    line-height: 1.1;
  }

  /* ⚠️ Both hints go, and neither is deleted — they are still right on a
     desktop. "← → mueven el asa" means nothing on a phone, and "las asas no se
     cruzan" spends a whole line explaining something a single drag shows. */
  .ed-track-hint,
  .ed-keys {
    display: none;
  }

  .ed-form {
    margin-top: 0.7rem;
    gap: 0.55rem;
  }

  .ed-publish {
    width: 100%;
    padding: 0.5rem 1.1rem;
  }

  .ed-submit {
    display: block;
  }

  .ed-submit .ed-hint {
    display: block;
    margin-top: 0.5rem;
  }
}
</style>
