<template>
  <div class="noUiSlider" ref="slider"></div>
</template>

<script>
import noUiSlider from "nouislider";

export default {
  name: "Slider",
  props: {
    properties: Object,
    points: Array,
    slideCallback: Function
  },
  data() {
    return {
      slider: null,
      onslide: false
    };
  },
  watch: {
    points(value) {
      if (!this.onslide) this.slider.noUiSlider.set(value);
    }
  },
  created() {},
  mounted() {
    this.slider = this.$refs.slider;
    noUiSlider.create(this.slider, this.properties);

    const that = this;

    this.slider.noUiSlider.on("slide", function(event) {
      that.onslide = true;
      that.$emit("slide", event);
      if (that.slideCallback) that.slideCallback(event, this);
    });
    this.slider.noUiSlider.on("set", () => {
      this.onslide = false;
    });
  },
  methods: {}
};
</script>

<style scoped></style>
