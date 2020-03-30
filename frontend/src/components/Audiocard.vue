<template>
  <div class="card" :class="view">
    <header class="card-header">
      <p class="card-header-title title">
        {{ clip.title }}
      </p>
    </header>
    <div class="card-content">
      <router-link :to="'/episode/' + buildUrl(episode)">
        <div class="media" v-if="view !== 'tiny'">
          <div class="media-left">
            <figure class="image is-48x48">
              <img :src="episode.cover" alt="Placeholder image" />
            </figure>
          </div>
          <div class="media-content episode-info">
            <p class="title is-4">{{ episode.title }}</p>
            <p class="subtitle is-6">
              {{ $moment(episode.date).format("DD/MM/YYYY") }}
            </p>
          </div>
        </div>
      </router-link>

      <div class="content">
        <Tags
          :tags="alltags"
          input-size="is-small"
          :loading="newtagloading"
          @newtag="addTag"
          @click="clickTag"
          :show-add-button="true"
          :show-hide-button="true"
        ></Tags>
      </div>
    </div>

    <div class="player">
      <div class="columns is-vcentered is-mobile">
        <div class="column has-text-left">
          <p>{{ currentTime }}</p>
        </div>
        <div class="column has-text-centered">
          <a
            class="button is-rounded is-icon button-animated"
            @click="play"
            :class="{
              'is-success': !playing || loading,
              'is-warning': playing && !loading,
              'is-loading': loading,
            }"
          >
            <span class="icon animated grow" :class="{ visible: !playing }">
              <i class="fas fa-play fa-fw"></i>
            </span>
            <span class="icon animated grow" :class="{ visible: playing }">
              <i class="fas fa-pause fa-fw"></i>
            </span>
          </a>
        </div>
        <div class="column has-text-right">
          {{ endTimeString }}
        </div>
      </div>

      <progress
        ref="progress"
        class="progress is-success"
        :value="currentms"
        :max="duration"
      ></progress>
    </div>

    <footer class="card-footer icon-buttons">
      <div class="">
        <!--
        <a class="has-text-info">
          <i class="fas fa-comments"></i> <span>{{ clip.comments }}</span>
        </a>
        -->
        <a class="vote-button has-text-success" @click="vote(1)">
          <span class="icon" v-if="!voteLoading.up">
            <i class="fas fa-thumbs-up"></i> <span>{{ clip.up }}</span>
          </span>
          <span class="icon" v-else>
            <i class="fas fa-spinner fa-spin"></i> <span>{{ clip.up }}</span>
          </span>
        </a>
        <a class="vote-button has-text-danger" @click="vote(-1)">
          <span class="icon" v-if="!voteLoading.down">
            <i class="fas fa-thumbs-down"></i> <span>{{ clip.down }}</span>
          </span>
          <span class="icon" v-else>
            <i class="fas fa-spinner fa-spin"></i> <span>{{ clip.down }}</span>
          </span>
        </a>
      </div>
      <div class="">
        <a class="has-text-success" @click="share">
          <i class="fas fa-share-square"></i>
        </a>
      </div>

      <input type="hidden" ref="share" :value="shareUrl" />
    </footer>
  </div>
</template>

<script>
import Tags from "./Tags";
import { timmings } from "../mixins/timings";

export default {
  name: "Audiocard",
  mixins: [timmings],
  components: { Tags },
  props: {
    clip: Object,
    episode: Object,
    view: String,
  },
  data() {
    return {
      player: null,
      playing: false,
      loading: false,
      currentTime: "00:00",
      currentms: 0.0,
      addedTags: [],
      newtagloading: false,
      playSend: false,
      voteLoading: {
        up: false,
        down: false,
      },
    };
  },
  computed: {
    endTimeString() {
      return this.formatTime(this.duration);
    },
    duration() {
      return this.clip.end - this.clip.start;
    },
    alltags() {
      return [...this.clip.tags, ...this.addedTags];
    },
    shareUrl() {
      return location.origin + "/" + this.clip.id;
    },
  },
  created() {
    this.$EventBus.$on("clip-play", (id) => {
      if (this.clip.id !== id && this.playing) {
        this.play();
        this.player.currentTime = this.clip.start;
      }
    });
  },
  mounted() {
    this.$refs.progress.addEventListener("click", (e) => {
      const percent = e.offsetX / this.$refs.progress.offsetWidth;
      this.player.currentTime = percent * this.duration + this.clip.start;
    });
  },
  methods: {
    play(forceStop) {
      this.$EventBus.$emit("clip-play", this.clip.id);
      forceStop = forceStop === true; //Para evitar el evento de ratón.
      if (this.loading) return;
      if (this.player === null) {
        this.loading = true;
        this.player = new Audio(this.episode.file);
        this.player.oncanplay = () => {
          if (this.loading) {
            this.player.currentTime = this.clip.start;
            this.player.play();
            this.playing = true;
          }
        };
        this.player.ontimeupdate = () => {
          this.loading = false;
          this.currentms = this.player.currentTime - this.clip.start;
          const duration = this.$moment.duration(
            Math.floor(this.currentms),
            "seconds"
          );
          this.currentTime = this.formatTime(duration.asSeconds());
          if (this.player.currentTime >= this.clip.end) {
            this.play(true);
            this.player.currentTime = this.clip.start;
          }
        };
      } else {
        if (this.playing || forceStop) {
          this.player.pause();
        } else {
          this.player.play();
        }
        this.playing = forceStop ? false : !this.playing;
      }

      if (!this.playSend) {
        this.playSend = true;
        this.request("/clips/" + this.clip.id + "/play", "POST");
      }
    },
    async vote(value) {
      try {
        if (value === 1) {
          this.voteLoading.up = true;
        } else if (value === -1) {
          this.voteLoading.down = true;
        }
        const request = await this.request(
          `/clips/${this.clip.id}/vote/${value}`,
          "POST"
        );
        const result = request.data;
        if (result.error) {
          this.$EventBus.$emit("notify", {
            class: "is-danger",
            text: "¡No puedes votar dos veces!",
          });
        } else {
          if (result.delete !== 0) {
            this.$emit("vote", { value: result.delete, sign: -1 });
          }
          if (result.add !== 0) {
            this.$emit("vote", { value: result.add, sign: 1 });
          }
        }
      } catch (ex) {
        this.notifyError(ex);
      } finally {
        this.voteLoading.up = false;
        this.voteLoading.down = false;
      }
    },
    async addTag(newtag) {
      try {
        this.newtagloading = true;
        const result = await this.request(
          `/clips/${this.clip.id}/tag/${newtag}`,
          "POST"
        );
        this.addedTags.push(result.data);
      } catch (ex) {
        if (this.isError(ex, 409, "Tag repeated")) {
          this.$EventBus.$emit("notify", {
            class: "is-warning",
            text: "Ese tag ya existe en ese clip.",
          });
        } else {
          this.notifyError(ex);
        }
      } finally {
        this.newtagloading = false;
      }
    },
    clickTag(tag) {
      if (this.$route.path === "/") {
        this.$EventBus.$emit("searchTag", tag.tag);
      } else {
        this.$router.push("/?tags=" + tag.tag);
      }
    },
    share() {
      const input = this.$refs.share;
      input.setAttribute("type", "text");
      input.select();
      document.execCommand("copy");
      input.setAttribute("type", "hidden");
      window.getSelection().removeAllRanges();
      this.$EventBus.$emit("notify", {
        class: "is-primary",
        text: "Enlace copiado al portapapeles. ¡Comparte la palabra gravinera!",
      });
    },
  },
  beforeDestroy() {
    if (this.player != null) {
      this.player.pause();
    }
  },
};
</script>

<style lang="scss" scoped>
progress::-webkit-progress-value {
  transition: all 500ms ease;
}
progress {
  margin-bottom: 0 !important;
  border-radius: 0;
  height: 0.5rem;
  z-index: 1;
}

.card-content {
  padding-bottom: 0.25rem;
  z-index: 2;
  overflow: visible;
}

figure.image {
  overflow: hidden;
}

.player {
  padding: 1.5rem 1.5rem 0;
  margin-top: auto;
  .columns {
    margin-bottom: 0;
  }
  progress {
    margin-left: -1.5rem;
    width: calc(100% + 3rem);
  }
}

.episode-info {
  width: 0;
  overflow: hidden;
  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.tags {
  margin-top: 1rem;
}

.tiny {
  .title {
    font-size: 1.5rem;
  }
}
</style>
