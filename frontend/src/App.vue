<template>
  <div id="fullpage">
    <transition-group
      name="notifications"
      tag="div"
      class="app-notification-container"
    >
      <div
        @click="noRemoveNotification(index)"
        v-for="(not, index) of notifications.list"
        class="notification"
        :key="not.key"
        :class="not.class"
      >
        <button class="delete" @click="removeNotification(index)"></button>
        <span v-html="not.text"></span>
      </div>
    </transition-group>

    <navbar></navbar>

    <div class="container">
      <transition name="component-fade" mode="out-in">
        <router-view v-if="!errorPage" />
        <component v-else :is="errorcomponent"></component>
      </transition>
    </div>

    <footer class="footer">
      <div class="hero-foot has-text-centered">
        <p>
          Todo el contenido de esta web es propiedad de
          <a href="https://gravina82.com" target="_blank">gravina82</a>.
        </p>
        <p>
          <span class="copyleft">&copy;</span> Índice gravinero
          <a href="https://github.com/DiCrEn/gravindex" target="_blank"
            >v. {{ version }}</a
          >
          by Dicren with &#9829;
        </p>
      </div>
    </footer>
  </div>
</template>

<script>
import Navbar from "./components/Navbar";
import E404 from "./views/errors/404";
import Eunknown from "./views/errors/Eunknown";

const TIMEOUT_NOTIFICATION = 2.5 * 1000;

export default {
  components: { Navbar },
  data() {
    return {
      notifications: {
        list: [],
        index: 0,
      },
      errorPage: false,
    };
  },
  computed: {
    errorcomponent() {
      switch (this.errorPage) {
        case 404:
          return E404;
        default:
          return Eunknown;
      }
    },
    version() {
      return process.env.PACKAGE_VERSION;
    },
  },
  watch: {
    $route() {
      this.errorPage = false;
    },
  },
  created() {
    this.$EventBus.$on("notify", (notification) => {
      notification.key = ++this.notifications.index;
      notification.timeout = setTimeout(() => {
        const index = this.notifications.list.indexOf(notification);
        this.notifications.list.splice(index, 1);
      }, TIMEOUT_NOTIFICATION);
      this.notifications.list.push(notification);
    });

    this.$EventBus.$on("error-page", (result) => {
      this.errorPage = result;
    });
  },
  methods: {
    removeNotification(index) {
      if (this.notifications.list[index].timeout)
        clearTimeout(this.notifications.list[index].timeout);
      this.notifications.list.splice(index, 1);
    },
    noRemoveNotification(index) {
      if (
        this.notifications.list[index] &&
        this.notifications.list[index].timeout
      )
        clearTimeout(this.notifications.list[index].timeout);
    },
  },
};
</script>

<style lang="scss">
@import "styles/style.scss";

html {
  background: linear-gradient(
    90deg,
    rgba(29, 29, 29, 1) 0%,
    rgba(50, 50, 50, 1) 50%,
    rgba(29, 29, 29, 1) 100%
  );
}

.footer {
  a {
    color: lighten(#4a4a4a, 5);
    &:hover {
      color: lighten(#4a4a4a, 10);
    }
  }
}
</style>
