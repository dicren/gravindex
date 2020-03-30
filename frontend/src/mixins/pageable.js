import Axios from "axios";
import _clone from "lodash.clonedeep";

export const pageable = {
  data() {
    return {
      getUrl: null,
      elements: null,
      timeout: 500,
      saveLimit: null,
      pageable: {
        limit: 10,
        page: 1,
        forcePage: null,
        totalElements: 0,
        defaultLimit: 10,
        defaultPage: 1,
      },
      filters: {},

      pageableAux: {
        updateTimeout: null,
        canceltoken: null,
        lastFilter: null,
        default: {
          pageable: {},
          filters: {},
        },
      },
    };
  },
  watch: {
    filters: {
      handler(/*niu, old*/) {
        this.updateListLauncher();
      },
      deep: true,
    },
    "pageable.limit": function (val) {
      if (this.saveLimit) {
        localStorage.setItem("savedLimit" + btoa(this.saveLimit), val);
      }
      this.updateList();
    },
    "pageable.page": function () {
      if (!this.pageable.forcePage) {
        this.updateList();
      }
    },
    $route(to) {
      if (Object.entries(to.query).length === 0) {
        this.resetForm();
      }
    },
  },
  mounted() {
    if (this.saveLimit !== false) {
      if (this.saveLimit === null || this.saveLimit === undefined) {
        this.saveLimit = this.getUrl;
      } else if (this.saveLimit === true) {
        this.saveLimit = "_GLOBAL_";
      }
    }

    this.pageable.limit =
      parseInt(this.$route.query.limit) ||
      this.getSavedLimit() ||
      this.pageable.defaultLimit ||
      10;
    this.pageable.page =
      parseInt(this.$route.query.page) || this.pageable.defaultPage || 1;

    this.pageableAux.default.pageable = Object.assign({}, this.pageable);
    this.pageableAux.default.filters = Object.assign({}, this.filters);
    for (let filter in this.filters) {
      let qv = this.$route.query[filter];
      if (qv) {
        if (Array.isArray(this.filters[filter])) {
          if (Array.isArray(qv)) {
            for (const q of qv) {
              this.filters[filter].push(q);
            }
          } else {
            this.filters[filter].push(qv);
          }
        } else {
          this.filters[filter] = qv;
        }
      }
    }
    this.updateList();
  },
  methods: {
    updateListLauncher() {
      this.cancelRequest();
      this.pageableAux.updateTimeout = setTimeout(() => {
        this.pageable.forcePage = 1;
        this.updateList();
      }, this.timeout);
    },
    updateQuery() {
      this.$router.replace({ query: this.filters });
    },
    updateList() {
      if (this.getUrl) {
        let filters = this.filters;
        if (this.pageable.forcePage) {
          filters.page = this.pageable.forcePage;
        } else {
          filters.page = this.pageable.page;
        }
        filters.limit = this.pageable.limit;

        //Evito repetir peticiones al servidor comprobando si le estoy pasando el mismo filtro
        if (
          !this.pageableAux.lastFilter ||
          JSON.stringify(this.pageableAux.lastFilter) !==
            JSON.stringify(filters)
        ) {
          this.cancelRequest();

          this.pageableAux.lastFilter = _clone(filters);

          this.updateQuery();

          this.elements = null;
          let { req, cancelToken } = this.request(
            this.getUrl,
            "GET",
            filters,
            true
          );
          this.pageableAux.canceltoken = cancelToken;
          req.then((res) => {
            this.elements = res.data.results;
            this.pageable.totalElements = res.data.total;
          });
          req.catch((ex) => {
            if (Axios.isCancel(ex)) {
              //console.log("Request canceled");
            } else {
              this.notifyError(ex);
            }
          });

          if (this.pageable.forcePage) {
            this.pageable.page = this.pageable.forcePage;
            this.pageable.forcePage = null;
          }
        }
      } else {
        console.error("You need define getUrl in data into your component");
      }
    },
    resetForm() {
      this.pageable = Object.assign({}, this.pageableAux.default.pageable);
      this.filters = Object.assign({}, this.pageableAux.default.filters);
    },
    cancelRequest() {
      this.pageableAux.lastFilter = null;
      if (this.pageableAux.updateTimeout)
        clearTimeout(this.pageableAux.updateTimeout);
      if (this.pageableAux.canceltoken) this.pageableAux.canceltoken.cancel();
    },
    getSavedLimit() {
      if (this.saveLimit) {
        const savedLimit = localStorage.getItem(
          "savedLimit" + btoa(this.saveLimit)
        );
        if (savedLimit) {
          return parseInt(savedLimit, 10);
        }
      }
      return false;
    },
  },
};
