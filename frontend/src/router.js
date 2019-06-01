import Vue from "vue";
import Router from "vue-router";
import Home from "./views/Home.vue";
import Episodes from "./views/Episodes.vue";
import E404 from "./views/errors/404.vue";
import Episode from "./views/Episode";
import Editor from "./views/Editor";
import EditorSearch from "./views/EditorSearch";
import About from "./views/About";
import Clip from "./views/Clip";

Vue.use(Router);

export default new Router({
  mode: "history",
  base: process.env.BASE_URL,
  routes: [
    {
      path: "/",
      name: "home",
      component: Home
    },
    {
      path: "/episodes/:page?",
      name: "episodes",
      component: Episodes
    },
    {
      path: "/episode/:title",
      name: "episode",
      component: Episode
    },
    {
      path: "/creator",
      name: "creator search",
      component: EditorSearch
    },
    {
      path: "/creator/:title",
      name: "creator",
      component: Editor
    },
    {
      path: "/about",
      name: "about",
      component: About
    },
    {
      path: "/:id",
      name: "clip",
      component: Clip
    },
    {
      path: "*",
      name: "E404",
      component: E404
    }
  ]
});
