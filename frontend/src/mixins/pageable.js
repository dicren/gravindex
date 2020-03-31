import Axios from "axios";
import _clone from "lodash/cloneDeep";
import _isEqual from "lodash/isEqual";
import { numberOrValue } from "@/helpers/numberOrValue";

export const pageable = {
  data() {
    return {
      getUrl: null,
      params: true, //¿USar los parámetros en la url?
      queryEnable: true,
      extraData: {},
      firstTime: true,
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
      firstLoaded: false,
      // Si los parámetros de la consulta son iguales a este se borran, porque está por defecto.
      defaultQuery: {},
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
  computed: {
    lastpage: function () {
      if (this.pageable.totalElements === 0) return 1;
      else return Math.ceil(this.pageable.totalElements / this.pageable.limit);
    },
  },
  watch: {
    filters: {
      handler() {
        if (this.firstLoaded && this.queryEnable) {
          //Para evitar recargar multiples veces al principio.
          this.updateListLauncher();
        }
      },
      deep: true,
    },
    getUrl() {
      if (this.firstLoaded && this.queryEnable) {
        //Para evitar recargar multiples veces al principio.
        this.updateListLauncher(true);
      }
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
    elements(v) {
      if (v) {
        this.firstTime = false;
      }
    },
    queryEnable(v) {
      if (v) {
        this.updateQuery();
        this.updateList();
      }
    },
  },
  mounted() {
    if (this.saveLimit) {
      if (this.saveLimit === true) {
        this.saveLimit = "_GLOBAL_";
      } else {
        this.saveLimit = this.getUrl;
      }
    }

    if (this.queryEnable) {
      this.updateFromQuery();
    }
  },
  methods: {
    updateFromQuery() {
      this.pageable.limit = this.params
        ? parseInt(this.$route.query.limit) ||
          this.getSavedLimit() ||
          this.pageable.defaultLimit ||
          10
        : this.pageable.defaultLimit || 10;

      this.pageable.page = this.params
        ? parseInt(this.$route.query.page) || this.pageable.defaultPage || 1
        : this.pageable.defaultPage || 1;

      this.pageableAux.default.pageable = Object.assign({}, this.pageable);
      this.pageableAux.default.filters = Object.assign({}, this.filters);
      for (let filter in this.filters) {
        let qv = this.$route.query[filter];
        if (qv) {
          if (Array.isArray(this.filters[filter])) {
            if (Array.isArray(qv)) {
              this.filters[filter] = [];
              for (const q of qv) {
                this.filters[filter].push(numberOrValue(q));
              }
            } else {
              this.filters[filter].push(numberOrValue(qv));
            }
          } else {
            this.filters[filter] = numberOrValue(qv);
          }
        }
      }
      this.updateList();
    },
    updateListLauncher(force) {
      this.pageableAux.updateTimeout = setTimeout(() => {
        this.pageable.forcePage = 1;
        this.updateList(force);
      }, this.timeout);
    },
    updateQuery() {
      if (this.params) {
        const urlFilters = {};
        for (const filter in this.filters) {
          if (
            !_isEqual(this.filters[filter], this.defaultQuery[filter]) &&
            !(
              filter === "page" &&
              this.filters[filter] === this.pageable.defaultPage
            ) &&
            !(
              filter === "limit" &&
              this.filters[filter] === this.pageable.defaultLimit
            )
          ) {
            urlFilters[filter] = this.filters[filter];
          }
        }
        this.$router.replace({ query: urlFilters }).catch(() => {});
      }
    },
    updateList(force) {
      if (this.getUrl) {
        if (this.queryEnable) {
          let filters = this.filters;
          if (this.pageable.forcePage) {
            filters.page = this.pageable.forcePage;
          } else {
            filters.page = this.pageable.page;
          }
          filters.limit = this.pageable.limit;

          //Evito repetir peticiones al servidor comprobando si le estoy pasando el mismo filtro
          // console.log(JSON.stringify(this.pageableAux.lastFilter), JSON.stringify(filters));
          if (
            force ||
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
            req
              .then((res) => {
                this.elements = res.data.results;
                this.pageable.totalElements = res.data.total;
                for (const key in this.extraData) {
                  if (
                    // eslint-disable-next-line
                        this.extraData.hasOwnProperty(key) &&
                    // eslint-disable-next-line
                        res.data.hasOwnProperty(key)
                  ) {
                    this.extraData[key] = res.data[key];
                  } else {
                    this.extraData[key] = undefined;
                  }
                }
                this.firstLoaded = true;
              })
              .catch((ex) => {
                if (Axios.isCancel(ex)) {
                  //console.log("Request canceled");
                } else {
                  // noinspection JSUnresolvedVariable
                  if (this.catchPageable) {
                    // noinspection JSUnresolvedFunction
                    this.catchPageable(ex);
                  } else {
                    this.notifyError(ex);
                  }
                }
              });

            if (this.pageable.forcePage) {
              this.pageable.page = this.pageable.forcePage;
              this.pageable.forcePage = null;
            }
          }
        }
      } else {
        // eslint-disable-next-line
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
      if (this.pageableAux.canceltoken)
        this.pageableAux.canceltoken.cancel("Cancel");
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
