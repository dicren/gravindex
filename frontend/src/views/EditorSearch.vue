<template>
  <section class="section">
    <p class="title has-text-white-ter">
      Busca un episodio para recortar
    </p>
    <b-autocomplete
      :data="data"
      placeholder="Ejemplo: Verite 43"
      field="title"
      :loading="isFetching"
      @typing="getAsyncData"
      @select="clickSelect"
    >
      <template slot-scope="props">
        <div class="media">
          <div class="media-left">
            <img width="32" :src="props.option.cover" />
          </div>
          <div class="media-content">
            {{ props.option.title }}
            <br />
            <small>
              {{ props.option.date | $formatDate }}
            </small>
          </div>
        </div>
      </template>
    </b-autocomplete>
  </section>
</template>

<script>
import debounce from "lodash/debounce";
import BAutocomplete from "buefy/src/components/autocomplete/Autocomplete";
import { timmings } from "@/mixins/timings";

export default {
  name: "EditorSearch",
  components: { BAutocomplete },
  mixins: [timmings],
  data() {
    return {
      data: [],
      selected: null,
      isFetching: false,
    };
  },
  methods: {
    getAsyncData: debounce(function (name) {
      if (!name.length) {
        this.data = [];
        return;
      }
      this.isFetching = true;
      this.request(`/episodes/?search=${name}`)
        .then(({ data }) => {
          this.data = data.results;
          //data.results.forEach(item => this.data.push(item));
        })
        .catch((ex) => {
          this.data = [];
          this.notifyError(ex);
        })
        .finally(() => {
          this.isFetching = false;
        });
    }, 500),
    clickSelect(event) {
      this.$router
        .push({ name: "creator", params: { title: event.id } })
        .catch((err) => {});
    },
  },
};
</script>

<style scoped></style>
