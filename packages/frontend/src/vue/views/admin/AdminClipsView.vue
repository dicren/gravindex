<script setup lang="ts">
/**
 * Find the clip you came here to fix.
 *
 * ⚠️ **It reads the PUBLIC list endpoint, and that is not a shortcut.** There
 * is no `GET /api/admin/clips`: the admin surface exposes one clip at a time,
 * because moderation starts from a link someone sent you or a search for the
 * words that are wrong. Building a second, authenticated listing would double
 * the API surface to show exactly what `GET /clips` already shows — and this
 * screen has no business seeing anything a visitor cannot.
 *
 * ⚠️ The search box therefore behaves **exactly like the library's**: same
 * endpoint, same accent-insensitive matching over clip title, episode title and
 * tags, same 500 ms debounce and the same `limit` persistence, because it is
 * the same `useFilteredList`. Its own `id` keeps the remembered page size from
 * leaking into the public grid.
 *
 * ⚠️ Ordered by newest cut, unlike the library's "más votados". Moderation
 * arrives in the order things were posted, and the reason you are here is
 * almost always something that landed recently.
 */
import { useFilteredList } from '@/composables/use-filtered-list';
import { clipListQueryOptions } from '@/queries/clips.query';
import type { ClipListItem } from '#/domain/clips/clip.entity';
import GravLoading from '@/components/GravLoading.vue';
import GravPagination from '@/components/GravPagination.vue';

const { filters, page, limit, items, total, isPending, error, refetch } = useFilteredList<
  { search: string },
  ClipListItem
>({
  id: 'admin-clips',
  defaultFilters: { search: '' },
  defaultLimit: 12,
  queryOptions: (query) => clipListQueryOptions({ ...query, order: 'clip.createdAt' }),
});
</script>

<template>
  <section class="admin-clips">
    <div class="admin-clips__search control-graviner">
      <v-text-field
        v-model="filters.search"
        placeholder="Busca el clip por título, episodio o tag"
        aria-label="Buscar clips que moderar"
        type="search"
        hide-details
      />
    </div>

    <Transition name="load" mode="out-in">
      <v-alert v-if="error" type="error" variant="tonal">
        <p>No se han podido cargar los clips.</p>
        <v-btn class="mt-2" variant="flat" color="warning" @click="refetch">Reintentar</v-btn>
      </v-alert>

      <GravLoading v-else-if="isPending" />

      <p v-else-if="items && items.length === 0" class="admin-clips__empty">
        No hay ningún clip que encaje con eso.
      </p>

      <div v-else-if="items">
        <v-list class="admin-clips__list" bg-color="transparent" lines="two">
          <v-list-item
            v-for="clip of items"
            :key="clip.id"
            :to="{ name: 'adminClip', params: { id: clip.id } }"
            class="admin-clips__item"
          >
            <v-list-item-title>
              <span class="admin-clips__id">#{{ clip.id }}</span>
              {{ clip.title }}
            </v-list-item-title>

            <v-list-item-subtitle>
              {{ clip.episode.title }}
              <template v-if="clip.tags.length > 0"> · {{ clip.tags.join(', ') }}</template>
            </v-list-item-subtitle>
          </v-list-item>
        </v-list>

        <GravPagination v-model:page="page" v-model:limit="limit" :total="total" class="mt-4" />
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.admin-clips__search {
  margin-bottom: 1.25rem;
}

.admin-clips__id {
  opacity: 0.6;
  margin-right: 0.35rem;
}

.admin-clips__empty {
  opacity: 0.8;
}
</style>
