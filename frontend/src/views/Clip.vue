<template>
  <section class="section">
    <Audiocard v-if="clip" :clip="clip" :episode="clip.episode"></Audiocard>
    <Loading v-else></Loading>
  </section>
</template>

<script>
import Audiocard from "../components/Audiocard";
import Loading from "../components/helpers/Loading";

export default {
  name: "Clip",
  components: { Loading, Audiocard },
  data() {
    return {
      clip: null
    };
  },
  async created() {
    try {
      const request = await this.request("/clips/" + this.$route.params.id);
      this.clip = request.data;
    } catch (ex) {
      this.notifyError(ex, true);
    }
  }
};
</script>

<style scoped></style>
