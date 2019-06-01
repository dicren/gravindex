<template>
  <nav
    ref="nav"
    class="app-pagination"
    role="navigation"
    aria-label="pagination"
  >
    <ul
      class="pagination-list"
      :class="{ centered: nButtons > displaypages.length }"
    >
      <li ref="limitselector" class="is-hidden-mobile">
        <div class="select">
          <select @change="changeLimit">
            <option
              :key="l"
              :value="l"
              v-for="l of limits"
              :selected="limit == l"
              >{{ l }} por página</option
            >
          </select>
        </div>
      </li>

      <li ref="firstbtn">
        <a
          class="button pagination-link pagination-first"
          :disabled="1 === page"
          @click="goto(1)"
        >
          <i class="fas fa-angle-double-left"></i>
        </a>
      </li>
      <li>
        <a
          class="button pagination-link pagination-previous"
          :disabled="1 === page"
          @click="goto(page - 1)"
        >
          <i class="fas fa-angle-left"></i>
        </a>
      </li>

      <li
        v-for="(pagec, index) in displaypages"
        v-bind:key="pagec"
        :ref="
          'pagebtn' +
            (Math.floor(displaypages.length / 2) === index ? 'center' : index)
        "
        class="page-item page"
      >
        <a
          @click="goto(pagec)"
          class="button pagination-link"
          :class="{
            'is-current': pagec === page,
            center: Math.floor(displaypages.length / 2) === index
          }"
          :aria-label="'Goto page ' + pagec"
          >{{ pagec }}</a
        >
      </li>

      <li>
        <a
          class="button pagination-link pagination-next"
          :disabled="lastpage === page"
          @click="goto(page + 1)"
        >
          <i class="fas fa-angle-right"></i>
        </a>
      </li>
      <li>
        <a
          class="button pagination-link pagination-last"
          :disabled="lastpage === page"
          @click="goto(lastpage)"
        >
          <i class="fas fa-angle-double-right"></i>
        </a>
      </li>

      <li ref="gotobtn" class="is-hidden-mobile">
        <input
          class="input goto"
          type="number"
          v-model="gotovalue"
          placeholder="Ir a"
          @input="manualpage"
          @keyup.enter="manualpage"
          :class="{ 'is-danger': wrongNumber }"
        />
      </li>
    </ul>

    <ul class="pagination-list"></ul>
  </nav>
</template>

<script>
export default {
  name: "Pagination",
  props: {
    total: Number,
    page: Number,
    limit: Number,
    options: Array
  },
  data: function() {
    return {
      limits: [5, 10, 20, 50, 100],
      nButtons: 0,
      gotovalue: null,
      timeoutgoto: null,
      wrongNumber: false
    };
  },
  created() {
    if (this.options) this.limits = this.options;
  },
  computed: {
    displaypages: function() {
      let elementsLeft = Math.floor((this.nButtons - 1) / 2);
      let elementsRight = elementsLeft;

      let firstElement = this.page - elementsLeft;
      if (firstElement <= 0) {
        const modify = firstElement - 1;
        elementsLeft += modify;
        elementsRight -= modify;
      }

      if (this.page + elementsRight > this.lastpage) {
        const modify = this.page + elementsRight - this.lastpage;
        elementsLeft += modify;
        elementsRight -= modify;
      }

      let pages = [];
      for (let i = elementsLeft; i > 0; i--) {
        const newpage = this.page - elementsLeft + -1 + i;
        if (newpage <= 0) break;
        pages.unshift(newpage);
      }
      pages.push(this.page);
      for (let i = 0; i < elementsRight; i++) {
        pages.push(this.page + 1 + i);
      }
      return pages;
    },
    lastpage: function() {
      return Math.ceil(this.total / this.limit);
    }
  },
  mounted() {
    window.addEventListener("resize", this.recalculateDisplay);
    this.recalculateDisplay();
  },
  methods: {
    recalculateDisplay() {
      const navCompStyle = getComputedStyle(this.$refs.nav);

      const elementWidth =
        this.$refs.nav.clientWidth -
        parseFloat(navCompStyle.paddingLeft) -
        parseFloat(navCompStyle.paddingRight);

      const correctiveValue = 15;

      const totalWidth = elementWidth;
      const buttonFirstWidth = this.$refs.firstbtn.offsetWidth;
      const buttonListWidth = this.$refs.pagebtncenter[0].offsetWidth;
      const buttonWidth = buttonListWidth || buttonFirstWidth;
      const selectWidth = this.$refs.limitselector.offsetWidth;
      const gotoWidth = this.$refs.gotobtn.offsetWidth;

      const avaliableWidth =
        totalWidth -
        buttonWidth * 4 -
        selectWidth -
        gotoWidth -
        correctiveValue;

      //Number of buttons
      this.nButtons = Math.trunc(avaliableWidth / buttonWidth);
    },
    goto(page) {
      if (page >= 1 && page <= this.lastpage) {
        if (this.page.toString().length !== page.toString().length) {
          this.recalculateDisplay();
        }
        this.$emit("update:page", page);
      }
      window.scrollTo(0, 0);
    },
    changeLimit(e) {
      const event = parseInt(e.target.value, 10); // Para el select tradicional
      let newPage = Math.ceil(((this.page - 1) * this.limit - 1) / event);
      this.$emit("update:limit", event);
      if (newPage !== this.page) {
        this.goto(newPage);
      }
    },
    manualpage() {
      if (this.timeoutgoto) clearTimeout(this.timeoutgoto);
      if (
        !this.gotovalue ||
        (this.gotovalue &&
          (this.gotovalue < 1 || this.gotovalue > this.lastpage))
      ) {
        this.wrongNumber = true;
      } else {
        this.wrongNumber = false;
        this.timeoutgoto = setTimeout(() => {
          this.$emit("update:page", parseInt(this.gotovalue));
        }, 500);
      }
    }
  },
  destroyed() {
    window.removeEventListener("resize", this.recalculateDisplay);
  }
};
</script>

<style lang="scss" scoped>
@import "~bulma/sass/utilities/mixins";

.goto {
  width: 3rem;
  margin-left: 0.25rem;
  -moz-appearance: textfield;
  &::-webkit-outer-spin-button,
  &::-webkit-inner-spin-button {
    -webkit-appearance: none;
  }
}

nav {
  display: block;
}

.pagination-list {
  display: flex;
  justify-content: space-between;
  &.centered {
    justify-content: center;
  }

  & > li {
    display: inline-block;
  }
}
.button.pagination-link {
  transition: none;
}
.pagination-list li {
  flex-grow: 0 !important;
}

@include mobile {
  .pagination-list li {
    font-size: 0.75rem;
    a {
      min-width: 1.5rem;
    }
  }
}
</style>
