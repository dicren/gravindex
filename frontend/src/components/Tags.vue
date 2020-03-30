<template>
  <div class="tags" :class="{ adding: show }">
    <a
      :key="tag.tag"
      class="tag is-graviner"
      @click="click(tag)"
      v-for="tag of tags"
    >
      {{ tag.tag || tag }}
      <button
        v-if="removable"
        @click="removeTag(tag.tag || tag)"
        class="delete is-small"
      ></button>
    </a>
    <a
      v-if="!show && !loading"
      class="tag is-rounded is-success tag-add"
      @click="showNewTag()"
      ><i class="fas fa-plus"></i
    ></a>

    <div
      class="field"
      v-else
      :class="{ 'has-addons': showAddButton || showHideButton }"
    >
      <div class="control" :class="controlClass">
        <b-autocomplete
          :data="autocompleteTags"
          :placeholder="placeholder"
          :loading="isFetching"
          @typing="filterTags"
          @select="addTagSelect"
          v-on:keyup.enter="addTag"
          :size="inputSize"
          :clear-on-select="true"
          :open-on-focus="true"
          :keep-first="true"
          v-model="value"
          ref="newtag"
        >
        </b-autocomplete>

        <!--
        <input
          v-on:keyup.enter="addTag"
          ref="newtag"
          class="input"
          :class="inputSize"
          v-model="value"
          type="text"
          :placeholder="placeholder"
        />
        -->
      </div>
      <div class="control" v-if="showAddButton">
        <button
          class="button is-info"
          @click="addTag()"
          :class="[{ 'is-loading': loading }, inputSize]"
        >
          <i class="fas fa-plus"></i>
        </button>
      </div>
      <div class="control" v-if="showHideButton">
        <button
          class="button is-danger"
          @click="show = false"
          :class="[{ 'is-loading': loading }, inputSize]"
        >
          <i class="fas fa-times"></i>
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import BAutocomplete from "buefy/src/components/autocomplete/Autocomplete";
import removeAccents from "remove-accents";

export default {
  name: "Tags",
  components: { BAutocomplete },
  props: {
    tags: {
      type: Array,
      default: () => {
        return [];
      },
    },
    loading: {
      type: Boolean,
      default: false,
    },
    alwaysinput: {
      type: Boolean,
      default: false,
    },
    removable: {
      type: Boolean,
      default: false,
    },
    placeholder: {
      type: String,
      default: "Añadir tag",
    },
    controlClass: {
      type: String,
      default: "",
    },
    inputSize: {
      type: String,
      default: "",
    },
    showAddButton: {
      type: Boolean,
      default: false,
    },
    showHideButton: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      value: "",
      autocompleteTags: [],
      allAutocompleteTags: [],
      loadingTags: false,
      isFetching: false,
      show: false,
    };
  },
  computed: {},
  created() {
    this.show = this.alwaysinput;
    if (this.show) {
      this.filterTags("");
    }
  },
  methods: {
    showNewTag() {
      this.show = true;
      this.filterTags("");
      setTimeout(() => {
        this.$refs.newtag.focus();
      }, 100);
    },
    addTag() {
      if (this.value !== "") {
        this.$emit("newtag", this.value);

        if (!this.alwaysinput) {
          this.show = false;
        }

        if (this.allAutocompleteTags.indexOf(this.value) === -1) {
          localStorage.setItem("tagstime", String(0));
        }
      }
      setTimeout(() => {
        this.value = "";
      }, 10);
    },
    removeTag(tag) {
      this.$emit("remove", tag);
    },
    click(tag) {
      this.$emit("click", tag);
    },
    addTagSelect(select) {
      if (select) {
        this.value = select;
        this.addTag();
      }
    },
    async filterTags(text) {
      this.isFetching = true;
      if (this.allAutocompleteTags.length === 0) {
        if (
          !localStorage.getItem("tags") ||
          parseInt(localStorage.getItem("tagstime")) <
            Date.now() - 1000 * 60 * 5
        ) {
          if (!this.loadingTags) {
            this.loadingTags = true;
            try {
              const request = await this.request("/tags/");
              this.allAutocompleteTags = request.data;
              localStorage.setItem(
                "tags",
                JSON.stringify(this.allAutocompleteTags)
              );
            } catch (ex) {
              this.notifyError(ex);
            } finally {
              this.loadingTags = false;
            }
            localStorage.setItem("tagstime", String(Date.now()));
          }
        } else {
          this.allAutocompleteTags = JSON.parse(localStorage.getItem("tags"));
        }
      }
      this.autocompleteTags = this.allAutocompleteTags.filter((m) =>
        removeAccents(m.toLowerCase()).includes(
          removeAccents(text.toLowerCase())
        )
      );
      this.isFetching = false;
    },
  },
};
</script>

<style lang="scss" scoped>
.tags {
  //margin-top: 0.5rem;
  .field {
    margin-bottom: 5px;
  }
}

.input {
  height: 2.25rem;
}

.tags.adding {
  //position: absolute;
}
</style>
