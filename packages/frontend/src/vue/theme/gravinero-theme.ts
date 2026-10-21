import type { ThemeDefinition } from 'vuetify';

/**
 * The gravinero identity, as a Vuetify theme.
 *
 * Every value below was read off the running site
 * (`indice.gravina82.com`) with `getComputedStyle`, so the browser's own
 * resolved values are the specification. The two named brand colours come from
 * the site's own variables; the rest are the colours it actually painted.
 *
 * ⚠️ This module is the ONE place a gravinero hex is allowed to be written.
 * `gravinero.css` re-declares the same values as `--grav-*` custom properties
 * (CSS cannot import from TypeScript), and `__tests__/gravinero-theme.spec.ts`
 * fails if the two ever drift or if a component grows a literal `#9a1d0d`.
 */
export const GRAVINERO = {
  /** `$red-gravinero` — titles inside cards, tags, `primary`. */
  red: '#9a1d0d',
  /** `$brown-gravinero` — nav hover/active, select chevrons, icons. */
  brown: '#dcc08e',

  /** The dark horizontal gradient: edge → centre → edge, on `html` and the navbar. */
  stageEdge: '#1d1d1d',
  stageCentre: '#323232',
  /** Text on the stage. */
  stageInk: '#ffffff',

  /** Card surface: white and square, with the two inks below. */
  card: '#ffffff',
  cardInk: '#4a4a4a',
  cardInkStrong: '#363636',
  /** Card footer hairline. */
  cardRule: '#ededed',
  /** Light panel. */
  panel: '#f5f5f5',

  /** `.control-graviner` — the dark-inset form controls. */
  fieldBg: '#1e1d1e',
  fieldInk: '#b6b6b6',
  fieldBorder: '#5a5a5a',

  /* ── Stage tones ─────────────────────────────────────────
   * ⚠️ These are all ink or panels ON THE STAGE. They are additions to this
   * file, never per-component CSS.
   */

  /** A row's second line — `Episodio · fecha` — and its action icons.
   *  ⚠️ Measured at 4,7:1 against `#323232`, the lightest point of the
   *  gradient, i.e. just over the 4,5:1 minimum. **Do not darken it.** */
  stageInkMuted: '#a49c93',
  /** Timecodes, counters, hints. Below the text minimum on purpose: it is only
   *  ever used at a size and weight where it is supporting detail. */
  stageInkFaint: '#8b837a',

  /** A raised panel on the stage: the clip permalink's hero, the editor. ⚠️ NOT
   *  `panel` above — that one is the light `#f5f5f5`, which paints the admin
   *  surface. Two panels, two grounds, and the names have to say so. */
  stagePanel: '#232120',
  /** An inset inside one of those: the editor's track and its episode map. */
  stagePanelDeep: '#1b1a19',
  /** The mobile filter sheet, which sits above the list rather than on it. */
  stagePanelSide: '#191817',

  /** Behind the pollitos band in the player. The band is a photograph with
   *  white between the birds, so the ground shows through it. */
  playerGround: '#6d1409',
  /** Ink on a brown fill — the queue pill, the play button's glyph. */
  onBrown: '#6b1a0c',

  /** The rule between two rows on the stage. */
  hairline: 'rgba(220, 192, 142, 0.13)',
  /** A button outline on the stage: the same brown, further up. */
  hairlineStrong: 'rgba(220, 192, 142, 0.35)',

  /** `lighten($red-gravinero, 20)` / `lighten($red-gravinero, 40)`: links on the stage. */
  link: '#ec3821',
  linkHover: '#f48c7f',

  /** The footer sits on the stage but is deliberately dim, almost background. */
  footerInk: '#4a4a4a',
  footerLink: '#575757',
  footerLinkHover: '#636363',

  /** Semantic colours. */
  danger: '#c44636',
  info: '#04819e',
  success: '#50cf72',
  warning: '#ffc200',
  /**
   * Vuetify wants an opaque token, so this is a translucent ink flattened over
   * `warning`.
   */
  onWarning: '#4d3a00',

  /** The hard drop shadow under every title and nav item. */
  shadowInk: '#000000',
} as const;

/**
 * The body face.
 *
 * ⚠️ **Barlow, self-hosted from `@fontsource/barlow`** — decided 2026-08-18.
 * It replaces the Roboto the app inherits
 * from Vuetify, so it has to be set as Vuetify's `defaults` font family and not
 * only in CSS: Vuetify writes `font-family` onto `.v-application`, which would
 * otherwise win over anything this stylesheet says about `body`.
 *
 * Not from Google's CDN, for the same reason nothing else here is: an offline
 * build has to render correctly, and a third-party font request is a third
 * party watching every visitor. ⚠️ The TITLE face still comes from Typekit, and
 * that is a licence decision rather than an oversight — see `index.html`.
 */
export const BODY_FONT_STACK = "'Barlow', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/**
 * The monospace face, for everything numeric: timecodes, counters, tag counts,
 * the editor's scale. ⚠️ Always paired with `font-variant-numeric: tabular-nums`
 * wherever digits stack, or a counter ticking from 9 to 10 shifts the row.
 *
 * Not shipped: the mockups drew IBM Plex Mono, the design says "any mono in
 * practice", and a second webfont for four digits is not worth the request.
 */
export const MONO_FONT_STACK =
  "ui-monospace, 'SFMono-Regular', 'SF Mono', Menlo, Consolas, monospace";

export const GRAVINERO_THEME_NAME = 'gravinero';

/**
 * ⚠️ A deliberately MIXED theme: `dark: true`, dark `background`, but a WHITE
 * `surface`. That is not an oversight — it is what the site is. Cards are white
 * panels floating on a dark gradient stage, and Vuetify's two tokens map onto
 * exactly that split, so a `<v-card>` and a `<v-container>` each come out right
 * without either of them naming a colour.
 *
 * `dark: true` is still correct despite the white surface: it drives ripples,
 * elevation and every component that asks `theme.current.dark`, and the stage —
 * navbar, page background, form controls — is what those sit on. The one thing
 * it gets wrong is `border-color`, which defaults to white and would make the
 * card footer's hairline invisible; `variables` below fixes that.
 */
export const gravineroTheme: ThemeDefinition = {
  dark: true,
  colors: {
    background: GRAVINERO.stageEdge,
    'on-background': GRAVINERO.stageInk,

    surface: GRAVINERO.card,
    'on-surface': GRAVINERO.cardInk,
    'surface-bright': GRAVINERO.card,
    'surface-light': GRAVINERO.panel,
    'surface-variant': GRAVINERO.panel,
    'on-surface-variant': GRAVINERO.cardInk,

    primary: GRAVINERO.red,
    'on-primary': GRAVINERO.stageInk,
    secondary: GRAVINERO.brown,
    'on-secondary': GRAVINERO.stageEdge,

    // The stage tones, exposed as Vuetify colours so a component can say
    // `color="stage-ink-muted"` instead of reaching for a variable.
    'stage-ink-muted': GRAVINERO.stageInkMuted,
    'stage-ink-faint': GRAVINERO.stageInkFaint,
    'stage-panel': GRAVINERO.stagePanel,
    'on-stage-panel': GRAVINERO.stageInk,

    error: GRAVINERO.danger,
    'on-error': GRAVINERO.stageInk,
    info: GRAVINERO.info,
    'on-info': GRAVINERO.stageInk,
    success: GRAVINERO.success,
    'on-success': GRAVINERO.stageInk,
    warning: GRAVINERO.warning,
    'on-warning': GRAVINERO.onWarning,
  },
  variables: {
    // Dividers and outlines land on the WHITE card, not on the dark stage, so
    // they take the card's ink. Vuetify's dark default (`#FFFFFF`) would draw
    // the `.card-footer` hairline white-on-white.
    'border-color': GRAVINERO.shadowInk,
    'border-opacity': 0.12,
  },
};

/** The whole theme map, ready for `createVuetify({ theme: { themes } })`. */
export const gravineroThemes = { [GRAVINERO_THEME_NAME]: gravineroTheme };
