<template>
  <transition name="load" mode="out-in">
    <div class="section" v-if="episode">
      <div class="columns">
        <div class="column">
          <Episode type="full" :episode="episode"></Episode>
        </div>
      </div>

      <p class="title has-text-white-ter">Los mejores momentos</p>

      <div v-if="episode.clips.length > 0" class="columns is-multiline">
        <div
          v-for="clip of episode.clips"
          :key="clip.id"
          class="column is-3-fullhd is-4-desktop is-6-tablet is-12-mobile"
        >
          <audiocard :clip="clip" :episode="episode" view="tiny"></audiocard>
        </div>
      </div>

      <div v-else class="columns is-multiline">
        <div class="column is-3-fullhd is-4-desktop is-6-tablet is-12-mobile">
          <div class="card card-to-add">
            <div class="card-content has-text-centered">
              <p class="has-text-centered">
                Esto está más vacío que la petaca de Melocotón Cane
              </p>
              <br />
              <router-link
                :to="'/creator/' + episode.id"
                class="button is-success"
                >¡Crea un clip!</router-link
              >
            </div>
          </div>
        </div>
      </div>
    </div>
    <Loading v-else></Loading>
  </transition>
</template>

<script>
import Episode from "../components/Episode";
import Loading from "../components/helpers/Loading";
import Audiocard from "../components/Audiocard";

export default {
  name: "EpisodeView",
  components: { Loading, Episode, Audiocard },
  data() {
    return {
      episode: null,
    };
  },
  async created() {
    try {
      const id = parseInt(this.$route.params.title);
      if (isNaN(id)) {
        this.$EventBus.$emit("error-page", 404);
      } else {
        const request = await this.request("/episodes/" + id);
        this.episode = request.data;
      }
    } catch (e) {
      this.notifyError(e, true);
    }
  },
};
</script>

<style lang="scss" scoped>
.card-to-add {
  background-image: url("~@/assets/gravinaBehindrecortadopeke.png");
  height: 320px;
  .card-content {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .button {
    margin-top: auto;
  }
}
</style>
