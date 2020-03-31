import Vue from "vue";
import App from "./App.vue";
import router from "./router";
import store from "./store";
import "./icons";
import Moment from "moment";
import Axios from "axios";
import VueAnalytics from "vue-analytics";

const SERVER_PORT = process.env.VUE_APP_SERVER_PORT || location.port;
const SERVER_LOCATION =
  process.env.VUE_APP_SERVER_LOCATION || location.hostname;
const PATH = process.env.VUE_APP_SERVER_PATH || "";

const SERVER_URL =
  location.protocol + "//" + SERVER_LOCATION + ":" + SERVER_PORT + "/" + PATH;

const createCancelToken = () => Axios.CancelToken.source();

Vue.config.productionTip = false;
Moment.locale("es");
Vue.prototype.$moment = Moment;

Vue.prototype.$EventBus = new Vue();

const mixin = {
  methods: {
    request: function (endpoint, type = "get", data, cancelable) {
      let headers;
      if (data && data.constructor && data.constructor === FormData) {
        headers = { "content-type": "multipart/form-data" };
      } else {
        headers = { "content-type": "application/json" };
      }

      let token =
        sessionStorage.getItem("token") || localStorage.getItem("token");

      if (token) {
        headers.Authorization = "Bearer " + token;
      }

      let url = (SERVER_URL + endpoint).replace(/([^:]\/)\/+/g, "$1");

      let cancelToken = cancelable ? createCancelToken() : undefined;

      const req = Axios({
        method: type,
        headers: headers,
        data: type.toUpperCase() !== "GET" ? data : undefined,
        params: type.toUpperCase() === "GET" ? data : undefined,
        url: url,
        cancelToken: cancelToken ? cancelToken.token : undefined,
        json: true,
      });

      if (cancelToken) {
        return { req, cancelToken };
      } else {
        return req;
      }
    },
    notifyError(ex, redirect) {
      if (ex.response && ex.response.status && redirect) {
        this.$EventBus.$emit("error-page", ex.response.status);
      } else {
        let text;
        if (ex && ex.response && ex.response.data) {
          text = `<b>${ex.response.data.error}</b> ${ex.response.data.message}`;
        } else {
          text = ex.toString();
        }

        this.$EventBus.$emit("notify", {
          class: "is-danger",
          text: text,
        });
      }
    },
    isError(ex, error, text) {
      return !!(
        ex.response &&
        ex.response.status &&
        ex.response.status === error &&
        (!text || ex.response.data.message === text)
      );
    },
    buildUrl(episode) {
      return (
        episode.id +
        "-" +
        episode.title.replace(/[^a-zA-Z0-9 ]/g, "").replace(/ /g, "-")
      );
    },
  },
};

Vue.mixin(mixin);

if (process.env.VUE_APP_ANALYTICS_KEY) {
  Vue.use(VueAnalytics, {
    id: process.env.VUE_APP_ANALYTICS_KEY,
    router,
  });
}

new Vue({
  router,
  store,
  render: (h) => h(App),
}).$mount("#app");
