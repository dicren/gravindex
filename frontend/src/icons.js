import Vue from "vue";
import { library } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { dom } from "@fortawesome/fontawesome-svg-core";

import {
  faPlay,
  faPause,
  faThumbsUp,
  faSpinner,
  faThumbsDown,
  faShareSquare,
  faGlobeEurope,
  faPlus,
  faTimes,
  faAngleDoubleLeft,
  faAngleLeft,
  faAngleRight,
  faAngleDoubleRight,
  faStepBackward,
  faStepForward,
  faSearchPlus,
  faSearchMinus,
  faSort,
  faSearch,
} from "@fortawesome/free-solid-svg-icons";

library.add(
  faPlay,
  faPause,
  faThumbsUp,
  faSpinner,
  faThumbsDown,
  faShareSquare,
  faGlobeEurope,
  faPlus,
  faTimes,
  faAngleDoubleLeft,
  faAngleLeft,
  faAngleRight,
  faAngleDoubleRight,
  faStepBackward,
  faStepForward,
  faSearchPlus,
  faSearchMinus,
  faSort,
  faSearch
);

//dom.watch();

Vue.component("font-awesome-icon", FontAwesomeIcon);
