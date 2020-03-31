<template>
  <nav class="navbar is-dark" role="navigation" aria-label="main navigation">
    <div class="navbar-brand">
      <router-link class="navbar-item is-hidden-mobile" :to="{ name: 'home' }">
        <img src="@/assets/logo.png" />
      </router-link>

      <router-link class="navbar-item main" :to="{ name: 'home' }">
        Biblioteca<span class="is-hidden-mobile"> gravinera</span>
      </router-link>

      <router-link class="navbar-item" :to="{ name: 'episodes' }">
        <span class="is-hidden-mobile">Lista de </span>episodios
      </router-link>

      <router-link class="navbar-item" :to="{ name: 'creatorSearch' }">
        Añadir corte
      </router-link>

      <router-link class="navbar-item is-hidden-mobile" :to="{ name: 'about' }">
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
    },
  },
};
</script>

<style lang="scss" scoped>
.router-link-active:not(.main),
.router-link-exact-active {
  color: $brown-gravinero !important;
}
.navbar-item:focus {
  background-color: transparent !important;
}

.navbar-item {
  transition: color 0.3s ease;
}

@include mobile {
  .navbar-brand {
    margin-bottom: -3rem;
    justify-content: center;
  }
}
</style>
