<script setup lang="ts">
/**
 * One clip, editable — the screen that replaces writing SQL against production.
 *
 * Three jobs, in the order they are needed: fix a title or a cut, fix or remove
 * a tag, and — as a last resort — delete the clip.
 *
 * ⚠️ **Deletion is permanent and it kills a URL.** The backend hard-deletes
 * inside a transaction (the votes, the plays and the tags go with it) and never
 * reuses the id, because a clip id *is* a public address: `/182` is what the
 * share button copies and what the Open Graph tags point at. Two ids removed by
 * hand years ago still answer 404 today, which is what a deletion looks like
 * from the outside forever after. The dialog says all of that in as many words —
 * a confirmation that only says "¿seguro?" teaches nothing and gets clicked
 * through.
 *
 * ⚠️ **A 400 shows the server's own sentence.** The backend runs a global
 * validation pipe and checks `end > start` against the MERGED clip, so it is
 * the only party that can explain some refusals. `domainErrorNotice` is what
 * turns that into text, and it branches on the domain error's `code` — never on
 * an HTTP status, which no view in this app is allowed to see.
 *
 * ⚠️ **A 401 is not shown at all.** It means the session ended, and
 * `session.noteFailure` returning `true` says so; `AdminLayout` watches for
 * that and navigates to the login form. Printing "no autorizado" next to a form
 * the admin is about to be taken away from would be noise.
 */
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { AdminClipChanges } from '#/domain/auth/admin-clip.entity';
import type { Tag } from '#/domain/tags/tag.entity';
import {
  useAdminClip,
  useDeleteAdminClip,
  useRemoveClipTag,
  useRenameClipTag,
  useUpdateAdminClip,
} from '@/queries/admin.query';
import { useAdminSessionStore } from '@/stores/admin-session.store';
import { useNotificationsStore } from '@/stores/notifications.store';
import { domainErrorNotice } from '@/utils/domain-error-notice';
import { formatClipTime } from '@/utils/format-time';
import GravLoading from '@/components/GravLoading.vue';
import GravTitle from '@/components/GravTitle.vue';

const route = useRoute();
const router = useRouter();
const session = useAdminSessionStore();
const notifications = useNotificationsStore();

/** ⚠️ Digits only. The backend's strict int pipe refuses `1e1` and `1.5`, so
 *  anything else here is a URL nobody should have followed, not a clip. */
const clipId = computed(() => {
  const raw = route.params.id;
  const text = (Array.isArray(raw) ? raw[0] : raw) ?? '';
  return /^\d+$/.test(text) ? Number(text) : 0;
});

const { data: clip, error: loadError, isPending } = useAdminClip(() => clipId.value);

const updateClip = useUpdateAdminClip();
const deleteClip = useDeleteAdminClip();
const renameTag = useRenameClipTag();
const removeTag = useRemoveClipTag();

// ── The edit form ────────────────────────────────────────────────────────────

const titleDraft = ref('');
const startDraft = ref('');
const endDraft = ref('');
const formMessage = ref('');
const busy = ref(false);

/**
 * ⚠️ Reseeded whenever the clip arrives or changes, `immediate` so the first
 * answer fills the form. Without it the fields stay empty behind a loaded clip
 * and the first save would blank the title.
 */
watch(
  clip,
  (value) => {
    if (!value) return;
    titleDraft.value = value.title;
    startDraft.value = String(value.start);
    endDraft.value = String(value.end);
  },
  { immediate: true },
);

/** Whole non-negative seconds, or `null`. The API takes integers only. */
function parseSeconds(text: string): number | null {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

/**
 * Only what actually moved.
 *
 * ⚠️ An untouched field must be **absent**, not resent: a PATCH that echoes the
 * stored value back is a write that can fail validation for a change nobody
 * made, and it hides which field the admin meant to edit.
 */
function pendingChanges(): AdminClipChanges | null {
  if (!clip.value) return null;

  const start = parseSeconds(startDraft.value);
  const end = parseSeconds(endDraft.value);
  if (start === null || end === null) {
    formMessage.value = 'El inicio y el fin son segundos enteros.';
    return null;
  }

  const changes: AdminClipChanges = {
    title: titleDraft.value === clip.value.title ? undefined : titleDraft.value,
    start: start === clip.value.start ? undefined : start,
    end: end === clip.value.end ? undefined : end,
  };

  if (Object.values(changes).every((value) => value === undefined)) {
    formMessage.value = 'No has cambiado nada.';
    return null;
  }
  return changes;
}

/** The one place a failed write decides between "say it" and "the session is over". */
function report(error: unknown, target: 'form' | 'tags'): void {
  if (session.noteFailure(error)) return;
  const notice = domainErrorNotice(error).text;
  if (target === 'form') formMessage.value = notice;
  else tagMessage.value = notice;
}

async function save(): Promise<void> {
  formMessage.value = '';
  const changes = pendingChanges();
  if (changes === null) return;

  busy.value = true;
  try {
    await updateClip.mutateAsync({ clipId: clipId.value, changes });
    notifications.push({ level: 'success', text: 'Clip guardado.' });
  } catch (error) {
    report(error, 'form');
  } finally {
    busy.value = false;
  }
}

// ── The tags ─────────────────────────────────────────────────────────────────

const editingTag = ref<Tag | null>(null);
const tagDraft = ref('');
const tagMessage = ref('');
const tagBusy = ref(false);

function startRename(tag: Tag): void {
  tagMessage.value = '';
  editingTag.value = tag;
  tagDraft.value = tag;
}

function cancelRename(): void {
  editingTag.value = null;
  tagDraft.value = '';
}

/**
 * ⚠️ Sent **exactly as typed** — not trimmed, not lower-cased, not stripped of
 * accents. A tag is matched byte for byte by `GET /clips?tags=…`, so tidying it
 * up here would mint one the library's filter can never select. Twelve of the
 * hundred-odd real tags carry an accent or an eñe.
 */
async function commitRename(tag: Tag): Promise<void> {
  tagMessage.value = '';
  if (tagDraft.value === tag) {
    cancelRename();
    return;
  }

  tagBusy.value = true;
  try {
    await renameTag.mutateAsync({ clipId: clipId.value, tag, newTag: tagDraft.value });
    notifications.push({ level: 'success', text: 'Tag renombrado.' });
    cancelRename();
  } catch (error) {
    report(error, 'tags');
  } finally {
    tagBusy.value = false;
  }
}

async function dropTag(tag: Tag): Promise<void> {
  tagMessage.value = '';
  tagBusy.value = true;
  try {
    await removeTag.mutateAsync({ clipId: clipId.value, tag });
    notifications.push({ level: 'success', text: `Tag «${tag}» quitado del clip.` });
  } catch (error) {
    report(error, 'tags');
  } finally {
    tagBusy.value = false;
  }
}

// ── The deletion ─────────────────────────────────────────────────────────────

const confirmingDelete = ref(false);
const deleting = ref(false);

async function confirmDelete(): Promise<void> {
  deleting.value = true;
  try {
    await deleteClip.mutateAsync(clipId.value);
    confirmingDelete.value = false;
    notifications.push({
      level: 'success',
      text: `Clip #${clipId.value} borrado. Su enlace ya no existe.`,
    });
    // ⚠️ `replace`: the clip's admin URL is gone too, so leaving it in the
    // history would make Back load a 404.
    await router.replace({ name: 'adminClips' });
  } catch (error) {
    confirmingDelete.value = false;
    report(error, 'form');
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <section class="admin-clip">
    <v-alert v-if="loadError" type="error" variant="tonal">
      {{ domainErrorNotice(loadError).text }}
    </v-alert>

    <GravLoading v-else-if="isPending" />

    <template v-else-if="clip">
      <GravTitle :level="2" size="md">Clip #{{ clip.id }}</GravTitle>

      <p class="admin-clip__meta">
        Episodio {{ clip.episodeId }} · {{ formatClipTime(clip.start) }} →
        {{ formatClipTime(clip.end) }}
      </p>

      <form class="admin-clip__form" @submit.prevent="save">
        <div class="control-graviner">
          <v-text-field v-model="titleDraft" label="Título" hide-details />
        </div>

        <div class="admin-clip__times">
          <div class="control-graviner">
            <v-text-field
              v-model="startDraft"
              label="Inicio (segundos)"
              inputmode="numeric"
              hide-details
            />
          </div>
          <div class="control-graviner">
            <v-text-field
              v-model="endDraft"
              label="Fin (segundos)"
              inputmode="numeric"
              hide-details
            />
          </div>
        </div>

        <v-alert v-if="formMessage" type="error" variant="tonal" role="alert">
          {{ formMessage }}
        </v-alert>

        <div>
          <v-btn type="submit" color="primary" variant="flat" :loading="busy" :disabled="busy">
            Guardar cambios
          </v-btn>
        </div>
      </form>

      <!-- ── Tags ────────────────────────────────────────────────────────── -->
      <GravTitle :level="3" size="sm">Tags</GravTitle>

      <p v-if="clip.tags.length === 0" class="admin-clip__empty">Este clip no tiene tags.</p>

      <ul v-else class="admin-clip__tags">
        <li v-for="tag of clip.tags" :key="tag" class="admin-clip__tag">
          <template v-if="editingTag === tag">
            <div class="control-graviner admin-clip__tag-input">
              <v-text-field
                v-model="tagDraft"
                :aria-label="`Nuevo nombre para el tag ${tag}`"
                density="compact"
                hide-details
                autofocus
              />
            </div>
            <v-btn
              size="small"
              variant="flat"
              color="primary"
              :loading="tagBusy"
              @click="commitRename(tag)"
            >
              Guardar
            </v-btn>
            <v-btn size="small" variant="text" @click="cancelRename">Cancelar</v-btn>
          </template>

          <template v-else>
            <v-chip color="primary" variant="flat" size="small" label>{{ tag }}</v-chip>
            <!-- ⚠️ The tag is in the accessible name of both buttons. A list of
                 eight rows of "Renombrar"/"Quitar" names nothing at all. -->
            <v-btn
              size="small"
              variant="text"
              :aria-label="`Renombrar el tag ${tag}`"
              @click="startRename(tag)"
            >
              Renombrar
            </v-btn>
            <v-btn
              size="small"
              variant="text"
              color="error"
              :aria-label="`Quitar el tag ${tag}`"
              :disabled="tagBusy"
              @click="dropTag(tag)"
            >
              Quitar
            </v-btn>
          </template>
        </li>
      </ul>

      <v-alert v-if="tagMessage" type="error" variant="tonal" role="alert" class="mt-2">
        {{ tagMessage }}
      </v-alert>

      <!-- ── Deletion ────────────────────────────────────────────────────── -->
      <div class="admin-clip__danger">
        <GravTitle :level="3" size="sm">Borrar el clip</GravTitle>
        <p class="admin-clip__empty">
          Borrarlo es definitivo: se va con sus votos, sus reproducciones y sus tags.
        </p>
        <v-btn color="error" variant="flat" @click="confirmingDelete = true">Borrar clip</v-btn>
      </div>

      <!-- ⚠️ The dialog spells out the consequence instead of asking "¿seguro?".
           The thing an admin needs to know before clicking is that a public
           address dies and the number is never handed out again — a question
           that only asks for confirmation gets confirmed. -->
      <v-dialog v-model="confirmingDelete" max-width="30rem">
        <v-card>
          <v-card-title>¿Borrar el clip #{{ clip.id }}?</v-card-title>
          <v-card-text>
            <p>
              Se borra para siempre, con sus votos, sus reproducciones y sus tags. El enlace
              <code>/{{ clip.id }}</code> dejará de funcionar y ese número no se reutilizará nunca.
            </p>
            <p class="mt-2">Esto no se puede deshacer.</p>
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn variant="text" :disabled="deleting" @click="confirmingDelete = false">
              Cancelar
            </v-btn>
            <v-btn color="error" variant="flat" :loading="deleting" @click="confirmDelete">
              Borrar para siempre
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </template>
  </section>
</template>

<style scoped>
.admin-clip__meta {
  opacity: 0.75;
  margin-bottom: 1rem;
}

.admin-clip__form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 34rem;
  margin-bottom: 2rem;
}

.admin-clip__times {
  display: flex;
  gap: 1rem;
}

.admin-clip__times > * {
  flex: 1 1 0;
}

.admin-clip__tags {
  list-style: none;
  padding: 0;
  margin: 0.5rem 0 2rem;
}

.admin-clip__tag {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0;
}

.admin-clip__tag-input {
  max-width: 16rem;
  flex: 1 1 auto;
}

.admin-clip__empty {
  opacity: 0.8;
  margin-bottom: 0.75rem;
}

.admin-clip__danger {
  border-top: 1px solid rgb(255 255 255 / 15%);
  padding-top: 1.5rem;
}
</style>
