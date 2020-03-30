<template>
  <div class="card" :class="type">
    <div class="card-image">
      <figure class="image">
        <img
          :src="episode.cover"
          alt="Placeholder image"
          @error="
            episode.cover =
              'https://gravina82.com/wp-content/uploads/2019/03/GRAVINA82_1400PX-281844_186x186.png'
          "
        />
      </figure>
    </div>

    <header class="card-header">
      <div class="card-header-title">
        <div class="title">
          <p>{{ episode.title }}</p>
          <p class="subtitle is-6">
            {{ $moment(episode.date).format("DD [de] MMMM [de] YYYY") }}
          </p>
        </div>
      </div>
    </header>

    <footer class="card-footer icon-buttons">
      <div class="">
        <router-link class="button is-info" :to="'/creator/' + episode.id"
          >Crear clip</router-link
        >
      </div>
      <div class="">
        <a class="has-text-info" target="_blank" :href="episode.originalUrl">
          <i class="fas fa-globe-europe"></i>
        </a>
      </div>
    </footer>
  </div>
</template>

<script>
export default {
  name: "Episode",
  props: {
    episode: Object,
    type: String,
  },
  computed: {},
};
</script>

<style lang="scss" scoped>
.card-header {
  box-shadow: none;
}
.card-footer {
  margin-top: auto;
}

.full .card-footer .fas {
  font-size: 1.5rem;
}
.tiny .card-footer .button {
  display: none;
}

figure.image {
  height: 10rem;
  overflow: hidden;
  display: flex;
  img {
    object-fit: cover;
  }
}
</style>
