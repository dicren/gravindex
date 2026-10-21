<script setup lang="ts">
/**
 * A clip's tags on a card: the chips, and the way to add one more.
 *
 * The only place in the app that writes a tag to an existing clip. It owns
 * that mutation itself rather than handing it up to the card, so every screen
 * that shows a `ClipCard` — library, episode, permalink — gets tagging for free
 * and none of them repeats the outcome handling.
 *
 * ⚠️ **`already-present` is an outcome, not an error.** The backend answers 409
 * and `core/` turns it into `{ status: 'already-present' }` (see
 * `AddTagOutcome`), because a visitor tagging a clip with something it already
 * has did nothing wrong — the chip is right there. It gets an amber notice and
 * nothing else happens.
 *
 * ⚠️ **No local copy of the freshly added tag.** `useAddTag` invalidates the
 * clip keys instead, so the chip arrives with the refetch. Keeping a local copy
 * as well would double the chip for a beat.
 */
import { ref } from 'vue';
import type { Tag } from '#/domain/tags/tag.entity';
import { useAddTag } from '@/queries/clips.query';
import { useNotificationsStore } from '@/stores/notifications.store';
import { domainErrorNotice } from '@/utils/domain-error-notice';
import TagAutocomplete from './TagAutocomplete.vue';

const props = defineProps<{
  clipId: number;
  tags: readonly Tag[];
}>();

const emit = defineEmits<{ select: [tag: Tag] }>();

const notifications = useNotificationsStore();
const addTag = useAddTag();

const adding = ref(false);
const busy = ref(false);

async function submit(tag: Tag): Promise<void> {
  busy.value = true;
  try {
    const outcome = await addTag.mutateAsync({ clipId: props.clipId, tag });
    if (outcome.status === 'already-present') {
      notifications.push({ level: 'warning', text: 'Ese tag ya existe en ese clip.' });
    }
    adding.value = false;
  } catch (error) {
    notifications.push(domainErrorNotice(error));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="clip-tags">
    <v-chip
      v-for="tag of props.tags"
      :key="tag"
      tag="button"
      type="button"
      color="primary"
      variant="flat"
      size="small"
      label
      link
      :aria-label="`Filtrar por el tag ${tag}`"
      @click="emit('select', tag)"
    >
      {{ tag }}
    </v-chip>

    <!-- ⚠️ The icon is `aria-hidden`; the chip's `aria-label` is its only
         accessible name. Keep it that way: the plus glyph is decorative and
         must not supply the name. -->
    <v-chip
      v-if="!adding"
      tag="button"
      type="button"
      color="success"
      variant="flat"
      size="small"
      link
      aria-label="Añadir un tag a este clip"
      @click="adding = true"
    >
      <v-icon icon="mdi-plus" size="small" aria-hidden="true" />
    </v-chip>

    <div v-else class="clip-tags__input">
      <TagAutocomplete
        placeholder="Añadir tag"
        aria-label="Añadir un tag a este clip"
        :exclude="props.tags"
        :busy="busy"
        density="compact"
        autofocus
        @submit="submit"
      />
      <v-btn
        icon="mdi-close"
        variant="text"
        color="error"
        size="small"
        density="comfortable"
        :disabled="busy"
        aria-label="Cancelar"
        @click="adding = false"
      />
    </div>
  </div>
</template>

<style scoped>
.clip-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  margin-top: 1rem;
}

.clip-tags__input {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex: 1 1 12rem;
  min-width: 10rem;
}
</style>
