<template>
  <section class="section">
    <div class="columns">
      <div class="column">
        <div class="field">
          <div
            class="control is-expanded control-graviner has-icons-right big-search"
          >
            <input
              v-model="filters.search"
              class="input is-large"
              type="text"
              placeholder="Buscar capítulo"
            />
            <span class="icon is-small is-right">
              <font-awesome-icon icon="search" fixed-width />
            </span>
          </div>
        </div>
      </div>
    </div>

    <transition name="load" mode="out-in">
      <Loading v-if="!elements"></Loading>

      <div
        v-else-if="elements.length !== 0"
        class="columns is-multiline is-mobile"
      >
        <div
          v-for="episode of elements"
          :key="episode.id"
          class="column is-3-fullhd is-3-desktop is-4-tablet is-6-mobile"
        >
          <router-link :to="'/episode/' + buildUrl(episode)">
            <Episode :episode="episode" type="tiny"></Episode>
          </router-link>
        </div>

        <div class="column is-12">
          <Pagination
            :total="pageable.totalElements"
            :page.sync="pageable.page"
            :limit.sync="pageable.limit"
            :options="[12, 24, 48]"
          >
          </Pagination>
        </div>
      </div>
    </transition>
  </section>
</template>

<script>
import Episode from "../components/Episode";
import Loading from "../components/helpers/Loading";
import Pagination from "../components/helpers/Pagination";
import { pageable } from "../mixins/pageable.js";

export default {
  name: "Episodes",
  mixins: [pageable],
  components: { Pagination, Loading, Episode },
  data() {
    return {
      getUrl: "/episodes/",
      saveLimit: true,
      filters: {
        search: "",
      },
    };
  },
  created() {
    this.pageable.defaultLimit = 12;
  },
  methods: {},
};
</script>

<style lang="scss" scoped></style>
