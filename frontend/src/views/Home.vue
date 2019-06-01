<template>
  <section class="section">
    <div class="field">
      <div
        class="control is-expanded control-graviner has-icons-right big-search"
      >
        <input
          v-model="filters.search"
          class="input is-large"
          type="text"
          placeholder="¡Busca tú momento gravinero favorito!"
        />
        <span class="icon is-small is-right">
          <i class="fas fa-search fa-fw"></i>
        </span>
      </div>
    </div>

    <div class="columns">
      <div class="column is-narrow">
        <div class="field">
          <div
            class="control control-graviner has-icons-left select-mobile-100"
          >
            <div class="select">
              <select v-model="filters.order">
                <option value="points">Más valorados</option>
                <option value="clip.createdAt">Añadidos recientemente</option>
                <option value="episode.date">Fecha del capítulo</option>
              </select>
            </div>
            <div class="icon is-small is-left">
              <i class="fas fa-sort"></i>
            </div>
          </div>
        </div>
      </div>

      <div class="column column-tags">
        <Tags
          :tags="filters.tags"
          control-class="control-graviner"
          :alwaysinput="true"
          :loading="false"
          :removable="true"
          placeholder="Buscar por tag"
          @newtag="addTag"
          @remove="remTag"
        ></Tags>
      </div>

      <div class="column is-narrow is-hidden-mobile">
        <div class="field ">
          <div class="control has-text-right ">
            <button class="button is-warning" @click="resetForm">
              Limpiar
            </button>
          </div>
        </div>
      </div>
    </div>

    <transition name="load" mode="out-in">
      <Loading v-if="!elements"></Loading>

      <div v-else>
        <transition-group name="list" tag="div" class="columns is-multiline">
          <div
            v-for="(clip, index) of elements"
            :key="clip.id"
            class="column is-3-fullhd is-4-desktop is-6-tablet is-12-mobile transition-item"
          >
            <!-- para que no se superponga el dropdown de tags pongo el zindex en orden-->
            <audiocard
              :clip="clip"
              :episode="clip.episode"
              @vote="vote($event, clip)"
              :style="{ 'z-index': elements.length + 1 - index }"
            ></audiocard>
          </div>
        </transition-group>

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
import Audiocard from "../components/Audiocard";
import { pageable } from "../mixins/pageable.js";
import Pagination from "../components/helpers/Pagination";
import Loading from "../components/helpers/Loading";
import Tags from "../components/Tags";
import Vue from "vue";

export default {
  name: "Home",
  mixins: [pageable],
  components: { Audiocard, Pagination, Loading, Tags },
  data() {
    return {
      getUrl: "/clips/",
      saveLimit: true,
      filters: {
        search: "",
        order: "points",
        tags: []
      }
    };
  },
  created() {
    this.pageable.defaultLimit = 12;
    this.$EventBus.$on("searchTag", (tag) => {
      this.filters.tags = [tag];
    });
  },
  methods: {
    vote(event, clip) {
      if (event.value < 0) {
        clip.down = parseInt(clip.down, 10) + parseInt(event.sign, 10);
      } else {
        clip.up = parseInt(clip.up, 10) + parseInt(event.sign, 10);
      }
    },
    resetForm() {
      this.filters = {
        search: "",
        order: "points",
        tags: []
      };
    },
    addTag(value) {
      if (!this.filters.tags.includes(value)) {
        this.filters.tags.push(value);
      }
    },
    remTag(value) {
      Vue.delete(this.filters.tags, this.filters.tags.indexOf(value));
    }
  }
};
</script>

<style lang="scss" scoped>
//noinspection CssInvalidPseudoSelector
.column-tags ::v-deep .dropdown-menu {
  z-index: 49; //Límite de paginación máximo + 1.
}
</style>
