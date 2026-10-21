<script setup lang="ts">
/**
 * The clip permalink — the only screen where a clip is shown whole, and the one
 * strangers land on. Route `/:id`, name `clip`.
 *
 * ⚠️ **This URL is the one shared in the wild.** `https://indice.gravina82.com/178`
 * is what the share button copies and what the backend's Open Graph tags point
 * at, and links like it have been passed around since 2019. It also has to stay
 * catch-all-ish: `/:id` is the last route before the wildcard, so ANY single
 * unmatched segment lands here.
 *
 * ⚠️ **The vote button is here because `GET /clips/:id` carries `up`.** Nothing
 * else on this screen asks the backend for more than it already answers.
 *
 * What this screen draws: a hero panel on the stage, the full waveform with the
 * two times, actions **with words** rather than bare icons, and two strips of
 * rows underneath — `Relacionados · comparten tag` and `Del mismo episodio`.
 *
 * The two error paths are deliberately different, and the difference is "gone"
 * versus "broke":
 *
 * - **Gone** — a bad id or a `NotFoundError` navigates to the 404 route, so the
 *   ADDRESS changes (`router/error-navigation.ts`). Two clip ids (175 and 176)
 *   were deleted by hand years ago and their permalinks are still out there, so
 *   this path is real traffic.
 * - **Broke** — anything else stays put and offers a retry. Bouncing someone off
 *   the clip they asked for because the wifi blinked would lose the address they
 *   arrived with.
 */
import { computed, watch } from 'vue';
import { useQuery } from '@pinia/colada';
import { useRoute, useRouter } from 'vue-router';

import type { Clip } from '#/domain/clips/clip.entity';
import type { EpisodeDetail, EpisodeWaveform } from '#/domain/episodes/episode.entity';
import { NotFoundError, type DomainError } from '#/domain/errors';
import type { Tag } from '#/domain/tags/tag.entity';
import { useClipActions } from '@/composables/use-clip-actions';
import { clipQueryOptions, useRelatedClips } from '@/queries/clips.query';
import { episodeQueryOptions, episodeWaveformQueryOptions } from '@/queries/episodes.query';
import { goToNotFoundPage } from '@/router/error-navigation';
import { usePlaybackStore } from '@/stores/playback.store';
import { useQueueStore, type QueuedClip } from '@/stores/queue.store';
import { buildEpisodeUrl } from '@/utils/episode-url';
import { formatDateFull } from '@/utils/format-date';
import { formatClipTime } from '@/utils/format-time';
import { formatHhmmss } from '@/utils/timecode';
import ClipRowItem from '@/components/ClipRowItem.vue';
import ClipTagList from '@/components/ClipTagList.vue';
import GravWave from '@/components/GravWave.vue';

const route = useRoute();
const router = useRouter();
const playback = usePlaybackStore();
const queue = useQueueStore();
const actions = useClipActions();

/**
 * ⚠️ Digits only, and the whole segment. A clip id IS the entire path here, so
 * `/foo` and `/178-algo` are not permalinks — they are unmatched URLs that
 * landed on this route because it is the catch-all-ish one, and the honest
 * answer to them is 404. The new backend answers **400** to a malformed id,
 * which would route to the generic error page instead.
 */
function parseClipId(raw: string | readonly string[] | undefined): number | null {
  const text = (Array.isArray(raw) ? raw[0] : raw) ?? '';
  return /^\d+$/.test(text) ? Number(text) : null;
}

/**
 * Three states, and the third one is not decoration:
 *
 * - a **number** — fetch it;
 * - **`null`** — the segment is not a clip id, so this URL is a 404;
 * - **`undefined`** — we are on the way OUT of this route, and must do nothing.
 *
 * ⚠️ That last one is a bug found by a test. Vue Router updates `route` *before*
 * `<RouterView>` swaps the component, so for one tick after clicking a tag this
 * view is still mounted with `route.params.id` already gone; without the guard
 * it reads that as "not a number" and redirects to the 404 page.
 */
const clipId = computed<number | null | undefined>(() =>
  route.name === 'clip' ? parseClipId(route.params.id) : undefined,
);

/**
 * ⚠️ `useQuery` over the options factory rather than the ready-made `useClip`,
 * for one reason: `enabled`. A segment that is not a number must not become a
 * request — it is already known to be a 404.
 */
const {
  data: clip,
  error,
  refetch,
} = useQuery<Clip, DomainError>(() => ({
  ...clipQueryOptions(typeof clipId.value === 'number' ? clipId.value : 0),
  enabled: typeof clipId.value === 'number',
}));

const related = useRelatedClips(() => (typeof clipId.value === 'number' ? clipId.value : 0));

/**
 * The episode, for `Del mismo episodio`. ⚠️ Only once the clip has answered —
 * it is the clip that says which episode this is.
 *
 * ⚠️ Composed here rather than through `useEpisode()`/`useEpisodeWaveform()`,
 * for the same reason as `EpisodeView.vue`: `enabled`. Without it, the `?? 0`
 * fallback below fires `GET /api/episodes/0` (and its waveform) on every
 * mount, before the clip query has had a chance to answer.
 */
const episodeId = computed(() => clip.value?.episode.id ?? 0);
const episode = useQuery<EpisodeDetail, DomainError>(() => ({
  ...episodeQueryOptions(episodeId.value),
  enabled: clip.value !== undefined,
}));

/** ⚠️ 160 points, matching the permalink's own bar count in the mockups —
 *  `GravWave`'s `bars` prop below is the placeholder-only fallback. */
const waveform = useQuery<EpisodeWaveform, DomainError>(() => ({
  ...episodeWaveformQueryOptions(
    episodeId.value,
    clip.value === undefined ? {} : { from: clip.value.start, to: clip.value.end, points: 160 },
  ),
  enabled: clip.value !== undefined,
}));

/** ⚠️ `immediate`, and a watcher rather than a one-off: `/178` → `/179` reuses
 *  this same component instance, so the id can go bad without a remount. */
watch(
  clipId,
  (id) => {
    if (id === null) void goToNotFoundPage(router);
  },
  { immediate: true },
);

watch(
  error,
  (value) => {
    if (clipId.value === undefined) return;
    if (value instanceof NotFoundError) void goToNotFoundPage(router);
  },
  { immediate: true },
);

/** Everything that is not "this clip does not exist": we stay and offer a retry. */
const loadFailed = computed(() => error.value !== null && !(error.value instanceof NotFoundError));

const isCurrent = computed(() => clip.value !== undefined && playback.isCurrent(clip.value.id));
const isPlaying = computed(() => clip.value !== undefined && playback.isPlaying(clip.value.id));
const isQueued = computed(() => clip.value !== undefined && queue.contains(clip.value.id));

const duration = computed(() =>
  clip.value === undefined ? 0 : Math.max(0, clip.value.end - clip.value.start),
);
const elapsed = computed(() => (isCurrent.value ? playback.elapsed : 0));
const progress = computed(() => (duration.value <= 0 ? 0 : elapsed.value / duration.value));

/** Clips from the same episode, minus this one. ⚠️ `EpisodeClip` carries no
 *  episode of its own, which is why the row takes one as a prop. */
const siblings = computed(() =>
  (episode.data.value?.clips ?? []).filter((one) => one.id !== clip.value?.id),
);

function toQueued(): QueuedClip | undefined {
  const current = clip.value;
  if (current === undefined) return undefined;
  return {
    kind: 'clip',
    id: current.id,
    title: current.title,
    start: current.start,
    end: current.end,
    src: current.episode.file,
    episodeId: current.episode.id,
    episodeTitle: current.episode.title,
    cover: current.episode.cover,
    up: current.up,
  };
}

/**
 * `Pausar` / `Escuchar`.
 *
 * ⚠️ **`Escuchar` sounds immediately**, whatever the queue already held
 * (2026-08-19). It used to fall through to `enqueue`, which appends and only
 * starts playing when the queue was empty — so on a visit with anything queued,
 * pressing the one button on this screen that says "listen" played nothing and
 * silently added a row to a list on another page. `queue.playNow` puts the clip
 * straight after whatever is sounding and moves playback to it; `A la cola`
 * beside it is still the append.
 *
 * ⚠️ It goes through the queue store rather than the playback store, so the
 * global player shows it and the transport at the bottom is never out of step
 * with the button under the title.
 */
function togglePlay(): void {
  const queued = toQueued();
  if (queued === undefined) return;

  if (isPlaying.value) {
    playback.pause();
    return;
  }
  if (isCurrent.value) {
    playback.resume();
    return;
  }

  queue.playNow(queued);
}

function enqueue(): void {
  const queued = toQueued();
  if (queued !== undefined) actions.queue(queued);
}

function download(): void {
  const queued = toQueued();
  if (queued !== undefined) void actions.download(queued);
}

function seek(event: MouseEvent): void {
  if (!isCurrent.value) return;
  const bar = event.currentTarget;
  if (!(bar instanceof HTMLElement)) return;
  const { left, width } = bar.getBoundingClientRect();
  if (width === 0) return;
  playback.seekToFraction((event.clientX - left) / width);
}

/**
 * ⚠️ A tag clicked here **navigates**; on the library it merely narrows the
 * filter. That is why the row emits instead of routing: a card that branched
 * on `$route.path` internally would put routing knowledge inside a component
 * several screens share.
 */
function showLibraryForTag(tag: Tag): void {
  void router.push({ name: 'home', query: { tags: [tag] } });
}
</script>

<template>
  <main class="clipview">
    <div v-if="loadFailed" class="clipview__error">
      <p>No se ha podido cargar el corte.</p>
      <button type="button" class="q-btn" @click="refetch()">Reintentar</button>
    </div>

    <p v-else-if="!clip" class="clipview__hint grav-mono">cargando el corte…</p>

    <template v-else>
      <section class="grav-panel clip-hero">
        <div class="clip-hero__head">
          <RouterLink
            class="clip-hero__cover-link"
            :to="{ name: 'episode', params: { title: buildEpisodeUrl(clip.episode) } }"
          >
            <span
              class="clip-hero__cover"
              :style="{ backgroundImage: `url(${clip.episode.cover})` }"
            />
          </RouterLink>

          <div class="clip-hero__headings">
            <h1 class="clip-hero__title">{{ clip.title }}</h1>
            <p class="clip-hero__meta grav-mono">
              Corte {{ clip.id }} ·
              <RouterLink
                class="clip-hero__episode"
                :to="{ name: 'episode', params: { title: buildEpisodeUrl(clip.episode) } }"
                >{{ clip.episode.title }}</RouterLink
              >
              · {{ formatDateFull(clip.episode.date) }}
            </p>

            <ClipTagList
              :clip-id="clip.id"
              :tags="clip.tags"
              class="clip-hero__tags"
              @select="showLibraryForTag"
            />
          </div>
        </div>

        <button
          type="button"
          class="clip-hero__wave"
          :aria-label="`Buscar dentro de ${clip.title}`"
          @click="seek"
        >
          <GravWave
            :progress="progress"
            :seed="clip.id"
            :bars="160"
            :peaks="waveform.data.value?.peaks"
          />
        </button>
        <div class="clip-hero__times grav-mono">
          <span>{{ formatClipTime(elapsed) }}</span>
          <span>{{ formatClipTime(duration) }}</span>
        </div>

        <!-- ⚠️ Words, not bare icons. This is the one screen with room for them,
             and the one where a stranger arrives with no idea what the glyphs
             mean. -->
        <div class="clip-hero__actions">
          <button type="button" class="clip-hero__primary" @click="togglePlay">
            <v-icon :icon="isPlaying ? 'mdi-pause' : 'mdi-play'" size="15" aria-hidden="true" />
            {{ isPlaying ? 'Pausar' : 'Escuchar' }}
          </button>

          <button type="button" class="q-btn" :disabled="isQueued" @click="enqueue">
            <v-icon
              :icon="isQueued ? 'mdi-check' : 'mdi-playlist-plus'"
              size="15"
              aria-hidden="true"
            />
            {{ isQueued ? 'En la cola' : 'A la cola' }}
          </button>

          <button
            type="button"
            class="q-btn"
            :disabled="actions.voting.value"
            :aria-label="`Votar a favor (${clip.up} votos)`"
            @click="actions.vote(clip.id)"
          >
            <v-icon icon="mdi-thumb-up" size="15" aria-hidden="true" />
            {{ clip.up }}
          </button>

          <button type="button" class="q-btn" @click="actions.share(clip.id)">
            <v-icon icon="mdi-link-variant" size="15" aria-hidden="true" />
            Compartir
          </button>

          <button
            type="button"
            class="q-btn"
            :disabled="actions.isDownloading(clip.id)"
            @click="download"
          >
            <v-icon
              icon="mdi-download"
              size="15"
              aria-hidden="true"
              :class="{ 'grav-pulse': actions.isDownloading(clip.id) }"
            />
            {{ actions.isDownloading(clip.id) ? 'Descargando…' : 'Descargar' }}
          </button>

          <!-- Where the cut sits inside the whole episode. ⚠️ `hh:mm:ss`, not
               the clip's own `mm:ss`: these are positions in a two-hour file. -->
          <span class="clip-hero__hint">
            Del episodio completo: {{ formatHhmmss(clip.start) }} → {{ formatHhmmss(clip.end) }}
          </span>
        </div>
      </section>

      <!-- ⚠️ Absent, not empty, when a clip has no tags: there is nothing that
           could be related to it, and a heading over nothing is worse than no
           heading. -->
      <template v-if="related.data.value && related.data.value.length > 0">
        <h2 class="clipview__subhead grav-mono">Relacionados · comparten tag</h2>
        <div class="grav-list">
          <ClipRowItem
            v-for="row of related.data.value"
            :key="row.id"
            :clip="row"
            @select-tag="showLibraryForTag"
          />
        </div>
      </template>

      <template v-if="siblings.length > 0">
        <h2 class="clipview__subhead grav-mono">
          Del mismo episodio · {{ siblings.length }}
          {{ siblings.length === 1 ? 'corte' : 'cortes' }}
        </h2>
        <div class="grav-list">
          <ClipRowItem
            v-for="row of siblings"
            :key="row.id"
            :clip="row"
            :episode="clip.episode"
            compact
            @select-tag="showLibraryForTag"
          />
        </div>
        <p class="clipview__more">
          <RouterLink :to="{ name: 'episode', params: { title: buildEpisodeUrl(clip.episode) } }">
            Ver el episodio entero
          </RouterLink>
        </p>
      </template>
    </template>
  </main>
</template>

<style scoped>
.clipview {
  padding: 1.1rem;
  max-width: 1100px;
  margin: 0 auto;
}

.clip-hero__head {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  margin-bottom: 0.9rem;
}

.clip-hero__cover-link {
  flex: 0 0 auto;
  line-height: 0;
}

.clip-hero__cover {
  display: block;
  width: 104px;
  height: 104px;
  border-radius: 3px;
  background-color: var(--grav-stage-panel-deep);
  background-size: cover;
  background-position: center;
}

.clip-hero__headings {
  min-width: 0;
}

.clip-hero__title {
  font-family: var(--grav-font-title);
  font-weight: 400;
  text-transform: uppercase;
  font-size: 2.3rem;
  line-height: 1;
  color: var(--grav-stage-ink);
  text-shadow: var(--grav-title-shadow);
  margin: 0 0 0.3rem;
  overflow-wrap: anywhere;
}

.clip-hero__meta {
  font-size: 0.74rem;
  color: var(--grav-stage-ink-muted);
  margin: 0 0 0.5rem;
}

.clip-hero__episode {
  color: inherit;
  text-decoration: none;
}

.clip-hero__episode:hover,
.clip-hero__episode:focus-visible {
  color: var(--grav-brown);
}

.clip-hero__tags {
  margin-top: 0.5rem;
}

.clip-hero__wave {
  display: block;
  width: 100%;
  height: 62px;
  cursor: pointer;
  --grav-wave-idle: #3a3735;
  --grav-wave-played: rgb(var(--v-theme-primary));
}

.clip-hero__times {
  display: flex;
  justify-content: space-between;
  font-size: 0.72rem;
  color: var(--grav-stage-ink-faint);
  margin-top: 0.25rem;
}

.clip-hero__actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  align-items: center;
  margin-top: 0.9rem;
}

.clip-hero__primary {
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

.clip-hero__hint {
  font-size: 0.78rem;
  color: var(--grav-stage-ink-faint);
}

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

.q-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.q-btn:not(:disabled):hover,
.q-btn:focus-visible {
  border-color: var(--grav-brown);
  color: var(--grav-brown);
}

.clipview__subhead {
  font-size: 0.66rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--grav-brown);
  margin: 1.2rem 0 0.4rem;
}

.clipview__more {
  margin-top: 0.7rem;
  font-size: 0.85rem;
}

.clipview__hint {
  padding: 3rem 0;
  text-align: center;
  font-size: 0.75rem;
  color: var(--grav-stage-ink-faint);
}

.clipview__error {
  max-width: 32rem;
  margin: 2rem auto;
  padding: 1rem 1.2rem;
  border: 1px solid var(--grav-hairline-strong);
  border-left: 4px solid rgb(var(--v-theme-error));
  border-radius: 5px;
  background: var(--grav-stage-panel);
}

.clipview__error p {
  margin: 0 0 0.7rem;
}

@media (max-width: 720px) {
  .clipview {
    padding: 0.8rem 0.7rem;
  }

  .clip-hero__title {
    font-size: 1.7rem;
  }

  .clip-hero__cover {
    width: 72px;
    height: 72px;
  }
}
</style>
