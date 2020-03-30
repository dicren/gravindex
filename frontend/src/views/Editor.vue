<template>
  <transition name="load" mode="out-in">
    <div class="section" v-if="canplay">
      <div class="columns is-multiline">
        <div class="column is-12">
          <div class="card">
            <header class="card-header">
              <div class="card-header-title">
                <div class="title">
                  <p>Editor de cortes</p>
                  <p class="subtitle is-6">
                    {{ episode.title }}
                  </p>
                </div>
              </div>
            </header>

            <div class="card-content">
              <div class="field">
                <p>
                  Selecciona el momento de inicio y de fin en el audio, ponle un
                  título y unos tags y añádelo a la biblioteca.<br />
                  Recuerda que puedes consultar el
                  <a
                    href="https://docs.google.com/spreadsheets/d/1K_jSPXo0cLzOm7NeWSohPoRnfSoaWzDsFjjMc-n6PFY"
                    target="_blank"
                    >Índice gravinero en google docs.</a
                  >
                </p>
              </div>

              <div class="field">
                <label class="label">Título</label>
                <div class="control">
                  <input
                    class="input"
                    type="text"
                    v-model="title"
                    placeholder="Título"
                  />
                </div>
                <p class="help is-danger" v-if="validation.title">
                  Introduce un título para el corte.
                </p>
              </div>

              <div class="field">
                <label class="label">Tags</label>
                <div class="control">
                  <Tags
                    :tags="tags"
                    :removable="true"
                    input-size="is-small"
                    @newtag="addTag"
                    @remove="remTag"
                    :alwaysinput="true"
                    :show-add-button="true"
                  ></Tags>
                </div>
                <p class="help is-danger" v-if="validation.tags">
                  Introduce al menos un tag.
                </p>
              </div>

              <div class="space-between">
                <div id="start-point-control">
                  <label class="label is-hidden-mobile"
                    >Mover punto de inicio</label
                  >
                  <label class="label is-hidden-tablet">Inicio</label>
                  <p class="buttons seek-buttons">
                    <a
                      class="button is-rounded is-icon is-success has-text-weight-bold is-hidden-mobile"
                      @click="movePoint(-10, 'start')"
                    >
                      <span class="is-small">
                        - 10
                      </span>
                    </a>
                    <a
                      class="button is-rounded is-icon is-success has-text-weight-bold"
                      @click="movePoint(-5, 'start')"
                    >
                      <span class="is-small">
                        - 5
                      </span>
                    </a>
                    <a
                      class="button is-rounded is-icon is-success has-text-weight-bold"
                      @click="movePoint(-1, 'start')"
                    >
                      <span class="is-small">
                        - 1
                      </span>
                    </a>
                  </p>
                  <p class="buttons seek-buttons">
                    <a
                      class="button is-rounded is-icon is-success has-text-weight-bold is-hidden-mobile"
                      @click="movePoint(+10, 'start')"
                    >
                      <span class="is-small">
                        + 10
                      </span>
                    </a>
                    <a
                      class="button is-rounded is-icon is-success has-text-weight-bold"
                      @click="movePoint(+5, 'start')"
                    >
                      <span class="is-small">
                        + 5
                      </span>
                    </a>
                    <a
                      class="button is-rounded is-icon is-success has-text-weight-bold"
                      @click="movePoint(+1, 'start')"
                    >
                      <span class="is-small">
                        + 1
                      </span>
                    </a>
                  </p>
                  <p class="buttons">
                    <a
                      class="button is-rounded is-success has-text-weight-bold move-to-point"
                      @click="movePoint(currentTime, 'start', true)"
                    >
                      <span class="is-small is-hidden-mobile">
                        Mover al punto actual
                      </span>
                      <span class="is-small is-hidden-tablet">
                        <i class="fas fa-step-backward"></i>
                      </span>
                    </a>
                  </p>
                </div>

                <div id="player-control" class="has-text-centered">
                  <label class="label">&nbsp;</label>
                  <!-- Para alinearlo fácil -->
                  <div class="buttons">
                    <a
                      class="button is-rounded button-animated is-icon is-warning tooltip"
                      data-tooltip="Ir al inicio del corte"
                      @click="seekInit"
                    >
                      <i class="fas fa-step-backward"></i>
                    </a>

                    <a
                      class="button is-rounded is-icon button-animated is-success"
                      :class="{
                        'is-success': !playing,
                        'is-warning': playing,
                        'is-loading': waiting,
                      }"
                      @click="play"
                      ><span
                        class="icon animated grow"
                        :class="{ visible: !playing }"
                        ><i class="fas fa-play fa-fw"></i></span
                      ><span
                        class="icon animated grow"
                        :class="{ visible: playing }"
                        ><i class="fas fa-pause fa-fw"></i></span
                    ></a>

                    <a
                      class="button is-rounded button-animated is-icon is-warning tooltip"
                      data-tooltip="Ir al 5 segundos antes del final del corte"
                      @click="seekEnd"
                    >
                      <i class="fas fa-step-forward"></i>
                    </a>
                  </div>
                  <div class="buttons">
                    <a
                      class="button is-rounded button-animated is-icon is-info tooltip"
                      data-tooltip="Hacer zoom a la sección delimitada"
                      @click="setZoom()"
                    >
                      <i class="fas fa-search-plus"></i>
                    </a>

                    <a
                      class="button is-rounded button-animated is-icon is-info tooltip"
                      data-tooltip="Retrocede el zoom"
                      @click="setZoom(-10 * 60)"
                    >
                      <i class="fas fa-search-minus"></i>
                    </a>

                    <a
                      class="button is-rounded button-animated is-icon is-info tooltip"
                      data-tooltip="Reiniciar zoom"
                      @click="setZoom(0)"
                    >
                      <i class="fas fa-search"></i>
                    </a>
                  </div>
                  <div class="buttons">
                    <a
                      class="button is-rounded button-animated is-icon is-warning tooltip"
                      data-tooltip="Retrocede 1 minuto"
                      @click="movePlay(-60)"
                    >
                      <i class="fas fa-angle-double-left"></i>
                    </a>

                    <a
                      class="button is-rounded button-animated is-icon is-warning tooltip"
                      data-tooltip="Retrocede 10 segundos"
                      @click="movePlay(-10)"
                    >
                      <i class="fas fa-angle-left"></i>
                    </a>

                    <a
                      class="button is-rounded button-animated is-icon is-warning tooltip"
                      data-tooltip="Avanza 30 segundos"
                      @click="movePlay(30)"
                    >
                      <i class="fas fa-angle-right"></i>
                    </a>
                  </div>

                  <div class="buttons">
                    <label class="label">Velocidad x{{ playbackRate }}</label>

                    <Slider
                      class="playbackrateslider"
                      ref="playbackrateslider"
                      :properties="{
                        start: [1],
                        step: 0.5,
                        range: {
                          min: [0.5],
                          max: [4],
                        },
                      }"
                      @slide="playbackRate = $event[0]"
                      :points="[playbackRate]"
                    />
                  </div>
                </div>

                <div id="end-point-control">
                  <label class="label is-hidden-mobile"
                    >Mover punto final</label
                  >
                  <label class="label is-hidden-tablet">Final</label>
                  <p class="buttons seek-buttons">
                    <a
                      class="button is-rounded is-icon is-success has-text-weight-bold is-hidden-mobile"
                      @click="movePoint(-10, 'end')"
                    >
                      <span class="is-small">
                        - 10
                      </span>
                    </a>
                    <a
                      class="button is-rounded is-icon is-success has-text-weight-bold"
                      @click="movePoint(-5, 'end')"
                    >
                      <span class="is-small">
                        - 5
                      </span>
                    </a>
                    <a
                      class="button is-rounded is-icon is-success has-text-weight-bold"
                      @click="movePoint(-1, 'end')"
                    >
                      <span class="is-small">
                        - 1
                      </span>
                    </a>
                  </p>
                  <p class="buttons seek-buttons">
                    <a
                      class="button is-rounded is-icon is-success has-text-weight-bold is-hidden-mobile"
                      @click="movePoint(+10, 'end')"
                    >
                      <span class="is-small">
                        + 10
                      </span>
                    </a>
                    <a
                      class="button is-rounded is-icon is-success has-text-weight-bold"
                      @click="movePoint(+5, 'end')"
                    >
                      <span class="is-small">
                        + 5
                      </span>
                    </a>
                    <a
                      class="button is-rounded is-icon is-success has-text-weight-bold"
                      @click="movePoint(+1, 'end')"
                    >
                      <span class="is-small">
                        + 1
                      </span>
                    </a>
                  </p>
                  <p class="buttons">
                    <a
                      class="button is-rounded is-success has-text-weight-bold move-to-point"
                      @click="movePoint(currentTime, 'end', true)"
                    >
                      <span class="is-small is-hidden-mobile">
                        Mover al punto actual
                      </span>
                      <span class="is-small is-hidden-tablet">
                        <i class="fas fa-step-forward"></i>
                      </span>
                    </a>
                  </p>
                </div>
              </div>

              <Slider
                :key="sliderKey"
                ref="slider"
                :properties="sliderBarEditorProperties"
                @slide="
                  start = $event[0];
                  playtime = seek($event[1]);
                  end = $event[2];
                "
                :points="[start, playtime, end]"
                class="slider"
              ></Slider>

              <div class="space-between has-text-centered times-display">
                <div>
                  <label class="label is-hidden-mobile"
                    >Duración del corte</label
                  >
                  <span>{{ cutDuration }}</span>
                </div>

                <div>
                  <p>{{ formatTime(currentTime) }}</p>
                </div>

                <div>
                  <label class="label is-hidden-mobile"
                    >Duración del episodio</label
                  >
                  <span>{{ episodeDuration }}</span>
                </div>
              </div>
            </div>

            <footer class="card-footer icon-buttons">
              <div class=""></div>
              <div class="">
                <button
                  @click="save"
                  type="submit"
                  class="button is-success"
                  value="Guardar"
                  :class="{ 'is-loading': saveloading }"
                >
                  Publicar
                </button>
              </div>
            </footer>
          </div>
        </div>

        <div class="column is-12">
          <p class="title has-text-white-ter" v-if="episode.clips.length > 0">
            Clips ya creados para este capítulo
          </p>
          <p class="title has-text-white-ter" v-else>
            Este capítulo aún no tiene clips
          </p>
        </div>

        <div
          v-for="clip of episode.clips"
          :key="clip.id"
          class="column is-3-fullhd is-4-desktop is-6-tablet is-12-mobile episode-list"
        >
          <div class="card">
            <header class="card-header">
              <p class="card-header-title title">
                {{ clip.title }}
              </p>
            </header>

            <footer class="card-footer icon-buttons">
              <div class="">
                <button
                  class="button is-info"
                  @click="movePoint(clip.start, 'start', true)"
                >
                  Mover a este clip
                </button>
              </div>
              <div>
                <a class="has-text-success">
                  <i class="fas fa-share-square"></i>
                </a>
              </div>
            </footer>
          </div>
        </div>
      </div>
    </div>
    <Loading v-else></Loading>
  </transition>
</template>

<script>
import Loading from "../components/helpers/Loading";
import Tags from "../components/Tags";
import Vue from "vue";
import { timmings } from "../mixins/timings";
import Slider from "../components/Slider";

export default {
  name: "Editor",
  mixins: [timmings],
  components: { Slider, Tags, Loading },
  data() {
    return {
      sliderKey: 0,
      canplay: false,
      waiting: false,
      episode: null,
      timeoutCurrentTime: null,
      title: "",
      tags: [],
      slider: null,
      start: "00:00:00",
      end: 100,
      playtime: "00:00:00",
      duration: 0,
      currentTime: 0,
      playPoint: 0,
      playing: false,
      player: null,
      playbackRate: 1,
      sliderBarEditorProperties: null,
      sliderBarPlayerProperties: null,
      saveloading: false,
      zoom: {
        start: 0,
        end: 0,
      },
      validation: {
        title: false,
        tags: false,
      },
    };
  },
  computed: {
    episodeDuration() {
      return this.formatTime(this.duration);
    },
    cutDuration() {
      return this.formatTime(
        this.hhmmssToSeconds(this.end) - this.hhmmssToSeconds(this.start)
      );
    },
  },
  watch: {
    currentTime(value) {
      this.playtime = this.formatTime(value, true);
    },
    playbackRate(value) {
      this.player.playbackRate = parseFloat(value);
    },
  },
  async created() {
    try {
      const id = parseInt(this.$route.params.title);
      if (isNaN(id)) {
        this.$EventBus.$emit("error-page", 404);
      } else {
        const request = await this.request("/episodes/" + id);
        this.episode = request.data;

        this.player = new Audio(this.episode.file);
        this.player.oncanplay = () => {
          if (!this.canplay) {
            this.duration = this.player.duration;
            this.end = this.formatTime(this.duration - 60 * 10, true);
            this.zoom.end = this.duration;

            this.createSliderProperties();

            this.canplay = true;
          }
        };
        this.player.ontimeupdate = () => {
          if (this.waiting) this.waiting = false;
          this.audioToSection();
          this.currentTime = this.player.currentTime;
        };
        this.player.onwaiting = () => {
          this.waiting = true;
        };
      }
    } catch (e) {
      this.notifyError(e, true);
    }
  },
  methods: {
    createSliderProperties() {
      this.sliderBarEditorProperties = {
        start: [this.start, this.playtime, this.end],
        tooltips: [true, true, true],
        step: 1,
        connect: [false, true, true, false],
        behaviour: "unconstrained-tap",
        range: {
          min: [this.zoom.start],
          max: [this.zoom.end],
        },
        format: {
          to: (value) => {
            return this.formatTime(value, true);
          },
          from: (value) => {
            return this.hhmmssToSeconds(value);
          },
        },
      };
    },
    addTag(value) {
      if (!this.tags.includes(value)) {
        this.tags.push(value);
      }
    },
    remTag(value) {
      Vue.delete(this.tags, this.tags.indexOf(value));
    },
    movePoint(value, point, absolute) {
      const oldTime = this.hhmmssToSeconds(this[point]);
      const newValue = absolute ? value : oldTime + value;
      const newTime = this.formatTime(newValue, true);
      if (point === "start" && newValue > this.hhmmssToSeconds(this.end)) {
        return;
      }
      if (point === "end" && newValue < this.hhmmssToSeconds(this.start)) {
        return;
      }

      this[point] = newTime;
    },
    play() {
      if (this.playing) {
        this.player.pause();
      } else {
        this.checkInverted();
        this.player.play();
      }
      this.playing = !this.playing;
      this.audioToSection();
    },
    audioToSection() {
      const startsec = this.hhmmssToSeconds(this.start);
      const endsec = this.hhmmssToSeconds(this.end);
      if (
        this.player.currentTime < startsec ||
        this.player.currentTime > endsec
      ) {
        this.player.currentTime = startsec;
      }
    },
    seekInit() {
      this.player.currentTime = this.hhmmssToSeconds(this.start);
    },
    seekEnd() {
      this.player.currentTime = this.hhmmssToSeconds(this.end) - 5;
    },
    seek(timeHumaniced) {
      this.waiting = true;
      if (this.timeoutCurrentTime) clearTimeout(this.timeoutCurrentTime);
      this.timeoutCurrentTime = setTimeout(() => {
        this.player.currentTime = this.hhmmssToSeconds(timeHumaniced);
        this.waiting = false;
      }, 1000);
    },
    movePlay(amount) {
      this.waiting = true;
      if (this.timeoutCurrentTime) clearTimeout(this.timeoutCurrentTime);
      this.timeoutCurrentTime = setTimeout(() => {
        this.player.currentTime += amount;
        this.waiting = false;
      }, 100);
    },
    checkInverted() {
      if (this.hhmmssToSeconds(this.start) > this.hhmmssToSeconds(this.end)) {
        const aux = this.start;
        this.start = this.end;
        this.end = aux;
        return true;
      } else {
        return false;
      }
    },
    setZoom(value) {
      if (value === undefined) {
        const start = this.hhmmssToSeconds(this.start);
        const end = this.hhmmssToSeconds(this.end);
        const margin = (end - start) * 0.1;
        this.zoom.start = start - margin;
        this.zoom.end = Math.floor(end + margin);
      } else if (value !== 0) {
        this.zoom.start += value;
        this.zoom.end -= value;
      } else {
        this.zoom.start = 0;
        this.zoom.end = this.duration;
      }
      if (this.zoom.start < 0) this.zoom.start = 0;
      if (this.zoom.end > this.duration) this.zoom.end = this.duration;
      this.playtime = this.playtime = this.formatTime(this.currentTime, true);
      this.createSliderProperties();
      this.sliderKey++;
    },
    save() {
      let valid = true;
      if (this.title === "") {
        valid = false;
        this.validation.title = true;
      }
      if (this.tags.length === 0) {
        valid = false;
        this.validation.tags = true;
      }
      if (valid) {
        const data = {};
        data.title = this.title;
        data.tags = this.tags;
        data.start = this.hhmmssToSeconds(this.start);
        data.end = this.hhmmssToSeconds(this.end);
        data.episode = this.episode.id;

        this.saveloading = true;

        this.request("/clips/", "POST", data)
          .then(() => {
            this.$router.push("/episode/" + this.episode.id);
          })
          .catch((ex) => {
            this.notifyError(ex);
          })
          .finally(() => {
            this.saveloading = false;
          });
      }
    },
  },
  beforeDestroy() {
    if (this.player) {
      this.player.pause();
    }
  },
};
</script>

<style lang="scss" scoped>
@import "../styles/variables";
@import "~bulma/sass/utilities/mixins";

input[type="time"] {
  width: 8rem;
}
.slider {
  margin-top: 3rem;
  margin-bottom: 3rem;
}
.buttons {
  margin-bottom: 0;
  &.seek-buttons .button.is-icon {
    width: 3rem;
  }
}

.move-to-point {
  font-size: 0.854rem;
}
.move-to-point,
.zoom-button {
  width: 100%;
}

//noinspection CssInvalidPseudoSelector
.slider ::v-deep .noUi-origin:nth-child(3) .noUi-handle {
  width: 5px;
  background: $red-gravinero;
  border-width: 1px;
  .noUi-tooltip {
    bottom: -160%;
  }
}

.times-display > div {
  width: 10rem;
}

.playbackrateslider {
  width: 100%;
}

.episode-list .card-footer {
  margin-top: auto;
  border-top: 0;
}

@include mobile {
  .buttons.seek-buttons .button.is-icon {
    width: 2rem;
    height: 2rem;
    font-size: 0.9rem;
  }
  .move-to-point {
    width: 2.25rem;
  }
  #start-point-control,
  #end-point-control {
    width: 2.5rem;
  }
  #end-point-control {
    .buttons {
      margin-left: 0.5rem;
    }
  }
}
</style>
