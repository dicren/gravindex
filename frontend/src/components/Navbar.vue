<template>
  <nav class="navbar is-dark " role="navigation" aria-label="main navigation">
    <div class="navbar-brand">
      <router-link class="navbar-item is-hidden-mobile" to="/">
        <img src="@/assets/logo.png" />
      </router-link>

      <router-link class="navbar-item" to="/">
        Biblioteca&nbsp;<span class="is-hidden-mobile">gravinera</span>
      </router-link>

      <router-link class="navbar-item" to="/episodes">
        <span
          class="is-hidden-mobile
"
          >Lista de </span
        >&nbsp;episodios
      </router-link>

      <router-link class="navbar-item" to="/creator">
        Añadir corte
      </router-link>

      <router-link class="navbar-item is-hidden-mobile" to="/about">
        Sobre esta página
      </router-link>
    </div>
  </nav>
</template>

<script>
export default {
  name: "Navbar",
  methods: {
    not() {
      this.$EventBus.$emit("error-page", 404);
    }
  }
};
</script>

<style lang="scss" scoped>
@import "~bulma/sass/utilities/mixins";

@include mobile {
  .navbar-brand {
    margin-bottom: -3rem;
    justify-content: center;
  }
}
</style>
