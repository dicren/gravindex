<script setup lang="ts">
/**
 * `/cola` — the playback queue.
 *
 * ⚠️ **No filter rail: there is nothing to filter.** The queue is a list you
 * built by hand, so the chrome is a header with two actions and the rows.
 *
 * ⚠️ **Opening a shared link never overwrites the visitor's queue.** It shows
 * the shared list behind a banner offering `Añadir al final`, `Reemplazar la
 * mía` and `Descartar`. Silently replacing what
 * somebody had queued is the one thing a share link must not do, and there is
 * no undo for it.
 *
 * ⚠️ **Reordering by drag is on POINTER events, not HTML5 drag-and-drop**
 * (2026-08-19). The handle carried `draggable="true"` and worked with a mouse
 * and nowhere else: HTML5 DnD fires no `dragstart` for touch, so on a phone —
 * where a queue is most likely to be rearranged — the asa did nothing at all
 * and the screen's own hint told people to use it. Pointer events are one code
 * path for mouse, touch and pen, and still no dependency.
 *
 * ⚠️ **The list reorders live under the finger** rather than showing a drop
 * indicator: `queue.move` runs on every row the pointer crosses, so what you
 * see during the gesture is the queue you will get. It also means there is no
 * ghost image to draw, which is the only thing native DnD was giving us.
 *
 * ⚠️ **The gesture is tracked on `document`, not on the handle, and it must
 * stay that way.** The first version captured the pointer on the asa
 * (`setPointerCapture`) — and reordering the list MOVES that element in the
 * DOM, which drops the capture silently. The `pointerup` then landed on
 * whatever the finger happened to be over, `endDrag` never ran, and the row was
 * left dimmed for ever (fixed 2026-08-19).
 *
 * ⚠️ The same move is available from the keyboard with the two arrow buttons —
 * a drag-only reorder is unreachable for anyone not using a pointer.
 *
 * ⚠️ **Recorded deviation (2026-08-19): the list no longer shows everything.**
 * `queue.played` — everything before `currentIndex` — sits behind a "Historial"
 * toggle, so the first VISIBLE row is always the one playing. Row numbers
 * still count from the real position in the queue (`row.index + 1`),
 * not from 1 within what is shown, so a jump in the numbers is the tell that
 * something is hidden. The design drew the whole list; this departs from it on
 * purpose, because a queue that is a few clips deep otherwise scrolls what
 * matters — what is playing and what is next — off the top of the screen.
 *
 * ⚠️ **Nothing may reorder ahead of `currentIndex`.** `queue.next()` only ever
 * advances, so a clip dragged or arrowed above the one playing would never
 * sound again on its own — indistinguishable from deleting it — and with the
 * history collapsed it would also vanish from view. The drag handle is absent
 * on played rows and the up-arrow is disabled at the boundary.
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { getClipUseCase } from '#/config/clips.config';
import { toQueuedClip } from '@/composables/use-queue-hydration';
import { buildEpisodeUrl } from '@/utils/episode-url';
import { useClipActions } from '@/composables/use-clip-actions';
import { usePlaybackStore } from '@/stores/playback.store';
import { useNotificationsStore } from '@/stores/notifications.store';
import { keyOf, useQueueStore, type QueuedClip, type QueuedItem } from '@/stores/queue.store';
import { decodeQueueCode, encodeQueueCode, QUEUE_CODE_PARAM } from '@/utils/queue-code';
import { formatClipTime } from '@/utils/format-time';

const route = useRoute();
const router = useRouter();
const queue = useQueueStore();
const playback = usePlaybackStore();
const notifications = useNotificationsStore();
const actions = useClipActions();

/** Whether the played-clips section is unfolded. Starts collapsed every visit —
 *  the point of the toggle is that the default view starts at what is playing. */
const historyOpen = ref(false);

// Nothing left to hide (emptied, or the last played row removed) collapses it
// again, or a reopened `/cola` could show an empty, pointless toggle.
watch(
  () => queue.played.length,
  (n) => {
    if (n === 0) historyOpen.value = false;
  },
);

/** The clips a `?c=` code resolved to, or `null` when there is no code. */
const shared = ref<QueuedClip[] | null>(null);

const totalLabel = computed(() => formatClipTime(queue.totalSeconds));
/** How many whole episodes are in the queue — what the share link cannot
 *  carry. ⚠️ Counted rather than assumed absent: `?c=` is clip ids only
 *  (`utils/queue-code.ts`), so the screen has to say so BEFORE the link is
 *  copied rather than let somebody discover it at the other end. */
const queuedEpisodes = computed(() => queue.items.filter((item) => item.kind === 'episode').length);

/**
 * `3 cortes`, or `3 cortes · 1 episodio` once a whole episode is in the queue.
 *
 * ⚠️ The two are counted apart rather than lumped into "elementos": a queue of
 * clips is what this screen has always been, the word is the site's own, and a
 * queue holding a three-hour episode alongside four one-minute cuts is a fact
 * worth stating rather than averaging away.
 */
const countLabel = computed(() => {
  const episodes = queuedEpisodes.value;
  const clips = queue.size - episodes;
  const clipPart = clips === 1 ? '1 corte' : `${clips} cortes`;
  if (episodes === 0) return clipPart;

  const episodePart = episodes === 1 ? '1 episodio' : `${episodes} episodios`;
  return clips === 0 ? episodePart : `${clipPart} · ${episodePart}`;
});

/** `01:24`, or `--:--` for an episode nothing has measured yet — the length is
 *  the browser's to report and it has not played it. */
function lengthLabel(item: QueuedItem): string {
  const seconds = item.end - (item.kind === 'clip' ? item.start : 0);
  return seconds > 0 ? formatClipTime(seconds) : '--:--';
}

/** How much of the playing clip is left — `quedan 03:32` on the first row. */
const remainingLabel = computed(() =>
  formatClipTime(Math.max(0, playback.duration - playback.elapsed)),
);

/**
 * Resolve a shared code into clips.
 *
 * ⚠️ **Ids that no longer exist are dropped silently**, one by one: a shared
 * queue is a suggestion, and refusing the whole thing because one clip was
 * deleted is worse for the visitor than showing the four that are left.
 */
async function resolveShared(code: string): Promise<void> {
  const ids = decodeQueueCode(code);
  if (ids.length === 0) {
    shared.value = null;
    return;
  }

  const settled = await Promise.allSettled(ids.map((id) => getClipUseCase.execute(id)));
  shared.value = settled
    .filter((result) => result.status === 'fulfilled')
    .map((result) => toQueuedClip(result.value));
}

watch(
  () => route.query[QUEUE_CODE_PARAM],
  (raw) => {
    const code = Array.isArray(raw) ? raw[0] : raw;
    if (typeof code === 'string' && code !== '') void resolveShared(code);
    else shared.value = null;
  },
  { immediate: true },
);

/** Leave the code behind once it has been acted on, so a reload does not ask
 *  the same question again. */
function dismissShared(): void {
  shared.value = null;
  void router.replace({ query: {} }).catch(() => {});
}

function acceptShared(mode: 'append' | 'replace'): void {
  const clips = shared.value ?? [];
  if (mode === 'replace') queue.replaceWith(clips);
  else queue.enqueueMany(clips);
  dismissShared();
}

async function shareQueue(): Promise<void> {
  // ⚠️ Clip ids only. An episode in the queue is simply not in the link — see
  // `shareableClipIds`, and the line under the button that says so.
  const code = encodeQueueCode(queue.shareableClipIds);
  const url = `${window.location.origin}/cola?${QUEUE_CODE_PARAM}=${code}`;
  try {
    await navigator.clipboard.writeText(url);
    notifications.push({ level: 'success', text: 'Enlace de la cola copiado.' });
  } catch {
    notifications.push({ level: 'error', text: 'No se ha podido copiar el enlace.' });
  }
}

const sharedTotal = computed(() =>
  formatClipTime((shared.value ?? []).reduce((sum, clip) => sum + (clip.end - clip.start), 0)),
);

/** Drag state: the index being carried. `null` when nothing is. */
const dragging = ref<number | null>(null);

/** Which row sits under a point, by the index each one publishes on itself.
 *  ⚠️ `elementFromPoint` rather than the event's target: the pointer is
 *  captured by the handle for the whole gesture, so `event.target` is the asa
 *  from beginning to end and says nothing about where the finger is. */
function rowIndexAt(x: number, y: number): number | null {
  const row = document.elementFromPoint(x, y)?.closest('[data-queue-index]');
  if (!(row instanceof HTMLElement)) return null;
  const index = Number(row.dataset.queueIndex);
  return Number.isInteger(index) ? index : null;
}

function startDrag(index: number, event: PointerEvent): void {
  // Secondary buttons do not drag anything anywhere else on the web either.
  if (event.button > 0) return;

  dragging.value = index;
  document.addEventListener('pointermove', onDragMove);
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);
}

function onDragMove(event: PointerEvent): void {
  if (dragging.value === null) return;

  const over = rowIndexAt(event.clientX, event.clientY);
  // ⚠️ A destination at or before `currentIndex` would drop the dragged clip
  // ahead of what is playing — a clip `next()` would then skip over forever,
  // and one the collapsed history would swallow outright.
  if (over === null || over === dragging.value || over <= queue.currentIndex) return;

  queue.move(dragging.value, over);
  dragging.value = over;
}

/** ⚠️ Idempotent, and called from four places plus unmount: the one failure
 *  this whole mechanism has ever had was a drag that never ended. */
function endDrag(): void {
  dragging.value = null;
  document.removeEventListener('pointermove', onDragMove);
  document.removeEventListener('pointerup', endDrag);
  document.removeEventListener('pointercancel', endDrag);
}

// Leaving `/cola` mid-gesture must not leave two listeners on the document.
onUnmounted(endDrag);
</script>

<template>
  <main class="queue">
    <!-- The shared-queue banner. ⚠️ Three choices, and `Descartar` is one of
         them: a link somebody sent is not a command. -->
    <div v-if="shared && shared.length > 0" class="queue__banner">
      <p>
        Te han pasado una cola de <b>{{ shared.length }} cortes</b> ({{ sharedTotal }}). La tuya
        tiene <b>{{ queue.size }}</b> ahora mismo.
      </p>
      <div class="queue__banner-actions">
        <button type="button" class="q-btn" @click="acceptShared('append')">Añadir al final</button>
        <button type="button" class="q-btn" @click="acceptShared('replace')">
          Reemplazar la mía
        </button>
        <button type="button" class="q-btn" @click="dismissShared">Descartar</button>
      </div>
    </div>

    <div class="queue__head">
      <div>
        <h1 class="grav-stage-title queue__title">Cola de reproducción</h1>
        <span class="queue__meta grav-mono"> {{ countLabel }} · {{ totalLabel }} en total </span>
      </div>

      <!-- ⚠️ Two groups sharing one line, not three buttons in a row: the
           history stays where a reading order expects it, by the title; the
           two occasional actions — collapsed to an icon each, their aria-label
           carrying the name a test or a screen reader needs — sit pinned to the
           far edge, `.queue__actions-right`'s `margin-left: auto` doing the
           push regardless of whether the history button is even rendered. -->
      <div v-if="!queue.isEmpty" class="queue__actions">
        <button
          v-if="queue.played.length > 0"
          type="button"
          class="q-btn queue__history"
          :aria-expanded="historyOpen"
          aria-controls="queue-list"
          @click="historyOpen = !historyOpen"
        >
          <v-icon
            :icon="historyOpen ? 'mdi-chevron-up' : 'mdi-chevron-down'"
            size="15"
            aria-hidden="true"
          />
          Historial
          <b>{{ queue.played.length }}</b>
        </button>
        <div class="queue__actions-right">
          <button
            type="button"
            class="q-btn q-btn--icon"
            aria-label="Compartir la cola"
            @click="shareQueue"
          >
            <v-icon icon="mdi-link-variant" size="16" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="q-btn q-btn--icon q-btn--danger"
            aria-label="Vaciar"
            @click="queue.clear()"
          >
            <v-icon icon="mdi-delete" size="16" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>

    <!-- ⚠️ Said BEFORE the link is copied, not after. `?c=` carries two base62
         characters per clip id and has no room for a kind, and that format is a
         public URL shape (root `CLAUDE.md`), so a queued episode cannot travel
         in one. Silently sharing a shorter queue is the failure this line
         exists to prevent. -->
    <p v-if="queuedEpisodes > 0 && !queue.isEmpty" class="queue__notice grav-mono">
      {{ queuedEpisodes === 1 ? 'El episodio entero no viaja' : 'Los episodios enteros no viajan' }}
      en el enlace: quien lo abra recibirá solo los cortes.
    </p>

    <!-- ⚠️ The same joke as the library, plus the way back to it. -->
    <div v-if="queue.isEmpty" class="queue__empty">
      <p>Esto está más vacío que la petaca de Melocotón Cane</p>
      <RouterLink class="q-btn" :to="{ name: 'home' }">Ir a la biblioteca</RouterLink>
    </div>

    <template v-else>
      <div id="queue-list" class="grav-list">
        <article
          v-for="row of queue.rows"
          :key="keyOf(row.item)"
          v-show="historyOpen || row.index >= queue.currentIndex"
          class="q-row"
          :class="{
            'is-playing': row.index === queue.currentIndex,
            'is-played': row.index < queue.currentIndex,
            'is-dragging': dragging === row.index,
          }"
          :data-queue-index="row.index"
        >
          <!-- ⚠️ Only a row that may still move gets a handle: dragging one
               ahead of `currentIndex` would put it where it can never sound
               again. The empty span on the other rows keeps the five-track
               grid intact — see `.i-row__gap` in the CLAUDE.md for the same
               trap in the library row. -->
          <span
            v-if="row.index > queue.currentIndex"
            class="q-row__grip"
            aria-hidden="true"
            @pointerdown="startDrag(row.index, $event)"
            >⠿</span
          >
          <span v-else class="q-row__grip q-row__grip--off" aria-hidden="true" />

          <span class="q-row__num grav-mono">{{ row.index + 1 }}</span>

          <span class="q-row__cover" :style="{ backgroundImage: `url(${row.item.cover})` }" />

          <!-- ⚠️ **`sonando ahora` lives INSIDE the meta line, not above the
               title.** As its own line it added ~11 px to whichever row was
               playing, so every row in the queue changed height as the clip
               advanced and the list shuffled under the cursor. Here the block
               is two lines whatever the state, and the meta line is clipped
               rather than wrapped so it can never become three. -->
          <div class="q-row__main">
            <h2 class="q-row__title">
              <RouterLink
                v-if="row.item.kind === 'clip'"
                :to="{ name: 'clip', params: { id: row.item.id } }"
              >
                {{ row.item.title }}
              </RouterLink>
              <RouterLink
                v-else
                :to="{ name: 'episode', params: { title: buildEpisodeUrl(row.item) } }"
              >
                {{ row.item.title }}
              </RouterLink>
            </h2>
            <div class="q-row__meta">
              <template v-if="row.index === queue.currentIndex">
                <span class="q-row__now">sonando ahora · quedan {{ remainingLabel }}</span>
                <span aria-hidden="true"> · </span>
              </template>
              {{ row.item.kind === 'clip' ? row.item.episodeTitle : 'Episodio completo' }}
            </div>
          </div>

          <div class="q-row__side">
            <button
              type="button"
              class="q-row__ico"
              :aria-label="`Reproducir ${row.item.title}`"
              @click="queue.toggleAt(row.index)"
            >
              <v-icon
                :icon="
                  row.index === queue.currentIndex && playback.playing ? 'mdi-pause' : 'mdi-play'
                "
                size="16"
                aria-hidden="true"
              />
            </button>

            <span class="q-row__time grav-mono">{{ lengthLabel(row.item) }}</span>

            <!-- ⚠️ The keyboard's reorder. A drag handle alone is unreachable
                 without a mouse, and this list exists to be reordered.
                 ⚠️ Disabled at and below `currentIndex + 1`: nothing may move
                 to or past what is playing, the same rule the drag follows. -->
            <button
              type="button"
              class="q-row__ico"
              :disabled="row.index <= queue.currentIndex + 1"
              :aria-label="`Subir ${row.item.title} en la cola`"
              @click="queue.move(row.index, row.index - 1)"
            >
              <v-icon icon="mdi-arrow-up" size="16" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="q-row__ico"
              :disabled="row.index === queue.size - 1 || row.index <= queue.currentIndex"
              :aria-label="`Bajar ${row.item.title} en la cola`"
              @click="queue.move(row.index, row.index + 1)"
            >
              <v-icon icon="mdi-arrow-down" size="16" aria-hidden="true" />
            </button>

            <button
              type="button"
              class="q-row__ico"
              :aria-label="`Compartir ${row.item.title}`"
              @click="
                row.item.kind === 'clip'
                  ? actions.share(row.item.id)
                  : actions.shareEpisode(row.item)
              "
            >
              <v-icon icon="mdi-link-variant" size="16" aria-hidden="true" />
            </button>
            <!-- ⚠️ Absent, not disabled, on an episode row: the download button
                 cuts a clip out of an episode in the browser, and "the whole
                 three hours" is not a thing it can do or was ever asked to. The
                 grid tracks are `auto`, so the row simply has one control
                 fewer. -->
            <button
              v-if="row.item.kind === 'clip'"
              type="button"
              class="q-row__ico"
              :disabled="actions.isDownloading(row.item.id)"
              :aria-label="
                actions.isDownloading(row.item.id)
                  ? `Descargando ${row.item.title}…`
                  : `Descargar ${row.item.title}`
              "
              @click="actions.download(row.item)"
            >
              <v-icon
                icon="mdi-download"
                size="16"
                aria-hidden="true"
                :class="{ 'grav-pulse': actions.isDownloading(row.item.id) }"
              />
            </button>
            <button
              type="button"
              class="q-row__ico"
              :aria-label="`Quitar ${row.item.title} de la cola`"
              @click="queue.remove(keyOf(row.item))"
            >
              <v-icon icon="mdi-close" size="16" aria-hidden="true" />
            </button>
          </div>
        </article>
      </div>
    </template>
  </main>
</template>

<style scoped>
.queue {
  padding: 1.1rem;
  max-width: 1100px;
  margin: 0 auto;
}

.queue__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 0.9rem;
}

.queue__title {
  font-size: 1.6rem;
}

.queue__meta {
  display: block;
  margin-top: 0.25rem;
  font-size: 0.72rem;
  color: var(--grav-brown);
}

.queue__actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  /* Stretches across the rest of `.queue__head`'s row so the right group
     below has room to push into — otherwise the two clusters would just sit
     side by side instead of at opposite ends of the line. */
  flex: 1 1 auto;
  min-width: 0;
}

.queue__actions-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
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
  text-decoration: none;
  cursor: pointer;
}

.q-btn:hover,
.q-btn:focus-visible {
  border-color: var(--grav-brown);
  color: var(--grav-brown);
}

.q-btn--danger {
  color: #e28073;
  border-color: rgb(226 128 115 / 0.4);
}

/* Share and Vaciar: an icon and nothing else, so three controls fit on one
   line. The accessible name still carries the word — `aria-label`, not text. */
.q-btn--icon {
  padding: 0.32rem;
}

.queue__history b {
  font-family: var(--grav-font-mono);
  font-size: 0.7rem;
  background: rgb(var(--v-theme-primary));
  color: var(--grav-stage-ink);
  border-radius: 10px;
  padding: 0 0.3rem;
}

.queue__banner {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  flex-wrap: wrap;
  background: rgb(220 192 142 / 0.1);
  border: 1px solid var(--grav-hairline-strong);
  border-radius: 5px;
  padding: 0.6rem 0.8rem;
  margin-bottom: 0.9rem;
}

.queue__banner p {
  margin: 0;
  font-size: 0.88rem;
  color: #e6e0d7;
  flex: 1;
  min-width: 200px;
}

.queue__banner b {
  color: var(--grav-stage-ink);
}

.queue__banner-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.q-row {
  display: grid;
  grid-template-columns: 18px 26px 46px minmax(0, 1fr) auto;
  gap: 0.8rem;
  align-items: center;
  padding: 0.55rem 0.5rem;
  border-bottom: 1px solid var(--grav-hairline);
}

.q-row.is-playing {
  background: rgba(var(--v-theme-primary), 0.25);
  box-shadow: inset 3px 0 0 rgb(var(--v-theme-primary));
}

/* Only reachable with the history unfolded — read as past, not as inert. */
.q-row.is-played {
  opacity: 0.55;
}

.q-row__grip {
  color: #6f6860;
  font-size: 0.95rem;
  line-height: 1;
  text-align: center;
  cursor: grab;
  /* ⚠️ Load-bearing, not a nicety — see the note on the markup. */
  touch-action: none;
  user-select: none;
}

/* The placeholder on rows that may not move. ⚠️ Still occupies the grid's
   first track — an absent child would shift every column after it. */
.q-row__grip--off {
  cursor: default;
}

.q-row.is-dragging {
  opacity: 0.55;
}

.q-row.is-dragging .q-row__grip {
  cursor: grabbing;
}

.q-row__num {
  font-size: 0.75rem;
  color: var(--grav-stage-ink-faint);
  text-align: right;
}

.q-row__cover {
  width: 46px;
  height: 46px;
  border-radius: 2px;
  background-color: var(--grav-stage-panel);
  background-size: cover;
  background-position: center;
}

.q-row__main {
  min-width: 0;
}

/* Inline in the meta line: it must not add a line of its own. */
.q-row__now {
  font-family: var(--grav-font-mono);
  font-size: 0.66rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--grav-brown);
}

.q-row__title {
  font-family: var(--grav-font-title);
  font-weight: 400;
  text-transform: uppercase;
  font-size: 1.35rem;
  line-height: 1;
  margin: 0 0 0.12rem;
  overflow-wrap: anywhere;
}

.q-row__title a {
  color: var(--grav-stage-ink);
  text-decoration: none;
  text-shadow: var(--grav-title-shadow);
}

.q-row.is-playing .q-row__title a {
  color: var(--grav-brown);
}

.q-row__meta {
  font-size: 0.78rem;
  color: var(--grav-stage-ink-muted);
  /* One line, always: a row that wraps is a row that changes height. */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.q-row__side {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.q-row__time {
  font-size: 0.75rem;
  color: var(--grav-stage-ink-muted);
}

.q-row__ico {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  color: var(--grav-stage-ink-muted);
  cursor: pointer;
}

.q-row__ico:hover:not(:disabled),
.q-row__ico:focus-visible {
  color: var(--grav-brown);
}

.q-row__ico:disabled {
  opacity: 0.35;
  cursor: default;
}

.q-row.is-playing .q-row__ico {
  color: var(--grav-brown);
}

.queue__notice {
  margin: 0 0 0.7rem;
  font-size: 0.72rem;
  color: var(--grav-stage-ink-faint);
}

.queue__empty {
  text-align: center;
  padding: 2.6rem 1rem;
  color: var(--grav-stage-ink-muted);
}

.queue__empty p {
  margin: 0 auto 0.9rem;
  max-width: 34ch;
}

@media (max-width: 720px) {
  .q-row {
    grid-template-columns: 18px 46px minmax(0, 1fr);
    row-gap: 0.45rem;
  }

  .q-row__num {
    display: none;
  }

  .q-row__side {
    grid-column: 1 / -1;
    justify-content: space-between;
  }
}
</style>
