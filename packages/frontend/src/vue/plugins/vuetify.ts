import 'vuetify/styles';
import { createVuetify } from 'vuetify';
import { aliases, mdi } from 'vuetify/iconsets/mdi';

/*
 * ⚠️ The icon FONT is a separate import from the icon SET, and forgetting it is
 * silent: Vuetify happily resolves `mdi-play` into `<i class="mdi mdi-play">`
 * whether or not any stylesheet gives that class a glyph, so the app renders an
 * empty 24 px box and type-checks perfectly. This line is what puts a shape in
 * the box.
 *
 * The `mdi` set here is the CSS-class one — the whole font ships, one request,
 * cached across the site. The tree-shaken alternative (`@mdi/js` + the `mdi-svg`
 * set) would need every icon imported by name at every use site, a hand-kept
 * registry that is easy to let drift out of sync.
 */
import '@mdi/font/css/materialdesignicons.css';

import { GRAVINERO_THEME_NAME, gravineroThemes } from '@/theme/gravinero-theme';

/*
 * ⚠️ Import order is load order. `vuetify/styles` first, the gravinero sheets
 * after, so the identity always overrides Material's defaults without a single
 * `!important` — the few rules that must win regardless of what the bundler
 * emits first raise their specificity instead (see `html .v-application` in
 * `gravinero.css`).
 *
 * These are `.css`, not `.scss`, throughout: there is no `sass` in the
 * lockfile, and after baking the glitch keyframes (the one file that needed a
 * preprocessor, and only to write a table of constants) nothing here wants one.
 * Vite handles plain CSS with no dependency at all, which is one fewer moving
 * part, and a preprocessor would buy nothing here.
 */
/*
 * ⚠️ **Barlow, self-hosted**, in the two weights the design uses (400 for body
 * copy, 600 for the few labels that are emphasised). `@fontsource` rather than
 * Google's CDN, for the same reason nothing else here is remote: an offline
 * build has to render, and a font request is a third party watching every
 * visitor. The TITLE face is still Typekit's, and that is a licence decision —
 * see `index.html`.
 */
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/600.css';

import '@/theme/gravinero.css';
import '@/theme/transitions.css';
import '@/theme/glitch.css';

/**
 * The gravinero theme, not Material.
 *
 * `defaultTheme` names the only theme there is: this app has no light/dark
 * switch and is not getting one — the dark stage IS the brand. Vuetify still
 * registers its stock `light`/`dark` alongside; nothing selects them.
 */
export const vuetify = createVuetify({
  theme: {
    defaultTheme: GRAVINERO_THEME_NAME,
    themes: gravineroThemes,
  },
  /*
   * Stated explicitly rather than left to the default. Vuetify's own default
   * happens to be this exact set today, so omitting the block would work — and
   * would leave nothing to read when the font import above is the thing that
   * actually matters. `aliases` is the map behind `$dropdown`, `$close`,
   * `$next` and friends, i.e. the icons Vuetify's OWN components reach for; the
   * combobox chevron and the pagination arrows come from there, not from any
   * template in this repo.
   */
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: { mdi },
  },
  defaults: {
    // Square-cornered cards would make the site read as a wall of them.
    // Rounding them is the single change that would most make this stop looking
    // like itself.
    VCard: {
      rounded: 0,
    },
    // Forms are bordered boxes, not Material's filled troughs. This is
    // also what `.control-graviner` is drawn against — see `gravinero.css`.
    VTextField: { variant: 'outlined' },
    VTextarea: { variant: 'outlined' },
    VSelect: { variant: 'outlined' },
    VAutocomplete: { variant: 'outlined' },
    VCombobox: { variant: 'outlined' },
  },
});

export default vuetify;
