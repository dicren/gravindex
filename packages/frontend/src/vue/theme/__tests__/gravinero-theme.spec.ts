import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { useTheme } from 'vuetify';

import vuetify from '@/plugins/vuetify';
import GravTitle from '@/components/GravTitle.vue';
import { GRAVINERO, GRAVINERO_THEME_NAME, gravineroTheme } from '@/theme/gravinero-theme';

/**
 * The gravinero identity, asserted.
 *
 * This suite exists because a theme is the one kind of code that fails
 * *silently and beautifully*: swap the palette for Material's and everything
 * still renders, still passes type-check, still builds. Nothing here checks
 * that the CSS is pretty — it checks that the specific values the site has always
 * used are the values this one uses.
 */

const THEME_DIR = dirname(fileURLToPath(import.meta.url)).replace(/__tests__$/, '');
const VUE_DIR = join(THEME_DIR, '..');

const css = (file: string) => readFileSync(join(THEME_DIR, file), 'utf8');

/**
 * ⚠️ Comments are prose ABOUT the CSS, and these files explain at length what
 * they no longer do — `@font-face`, `percentage($i*(1/$steps))`. Asserting the
 * absence of something against the raw text matches the explanation instead of
 * the code, and passes or fails on the wording.
 */
const code = (file: string) => css(file).replace(/\/\*[\s\S]*?\*\//g, '');

/** Vuetify emits its palette as `--v-theme-<name>: r,g,b` triplets. */
const rgbTriplet = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',');

function stubBrowserApis() {
  // Vuetify's `useDisplay` reads `matchMedia`; jsdom has neither it nor
  // `ResizeObserver`, and without them `<v-app>` throws on mount.
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof window.ResizeObserver;
  }
}

describe('the gravinero Vuetify theme', () => {
  beforeAll(stubBrowserApis);

  const Harness = defineComponent({
    setup() {
      const theme = useTheme();
      return () => h('div', { 'data-theme': theme.name.value });
    },
  });

  it('is the active theme, and its palette is the gravinero one — not Material', () => {
    const wrapper = mount(Harness, { global: { plugins: [vuetify] } });

    expect(wrapper.attributes('data-theme')).toBe(GRAVINERO_THEME_NAME);

    const { colors } = vuetify.theme.global.current.value;
    expect(colors.primary).toBe(GRAVINERO.red);
    expect(colors.primary).toBe('#9a1d0d');
    expect(colors.secondary).toBe(GRAVINERO.brown);
    expect(colors.secondary).toBe('#dcc08e');
    expect(colors.background).toBe('#1d1d1d');

    // Vuetify's own defaults, so a regression to them is caught by name rather
    // than by "some hex changed".
    expect(colors.primary).not.toBe('#1867C0');
    expect(colors.primary).not.toBe('#6200EE');

    wrapper.unmount();
  });

  it('resolves that palette into the CSS variables components actually read', () => {
    const wrapper = mount(Harness, { global: { plugins: [vuetify] } });

    const sheet = document.getElementById('vuetify-theme-stylesheet')?.textContent ?? '';
    expect(sheet).not.toBe('');

    // A `<v-card color="primary">` paints `rgb(var(--v-theme-primary))`. These
    // four triplets are what that resolves to.
    expect(sheet).toContain(`--v-theme-primary: ${rgbTriplet(GRAVINERO.red)}`);
    expect(sheet).toContain(`--v-theme-secondary: ${rgbTriplet(GRAVINERO.brown)}`);
    expect(sheet).toContain(`--v-theme-background: ${rgbTriplet(GRAVINERO.stageEdge)}`);
    expect(sheet).toContain(`--v-theme-surface: ${rgbTriplet(GRAVINERO.card)}`);
    expect(rgbTriplet(GRAVINERO.red)).toBe('154,29,13');
    expect(rgbTriplet(GRAVINERO.brown)).toBe('220,192,142');

    wrapper.unmount();
  });

  it('keeps the mixed dark stage / light card split the site is built on', () => {
    // The trap in this theme: `dark: true` with a WHITE surface. If someone
    // "fixes" the inconsistency by darkening the surface, every card on the
    // site inverts at once.
    expect(gravineroTheme.dark).toBe(true);
    expect(gravineroTheme.colors?.surface).toBe('#ffffff');
    expect(gravineroTheme.colors?.background).toBe('#1d1d1d');
    // ...and the dividers that sit on that white card must not be white too.
    expect(gravineroTheme.variables?.['border-color']).toBe('#000000');
  });
});

describe('the stage gradient', () => {
  it('is declared once, with the stops the site uses, and shows through Vuetify', () => {
    const sheet = css('gravinero.css');

    // #1d1d1d → #323232 → #1d1d1d, horizontal.
    expect(sheet).toMatch(
      /--grav-gradient:\s*linear-gradient\(\s*90deg,\s*var\(--grav-stage-edge\) 0%,\s*var\(--grav-stage-centre\) 50%,\s*var\(--grav-stage-edge\) 100%\s*\)/,
    );
    expect(sheet).toMatch(/html\s*\{[^}]*background:\s*var\(--grav-gradient\)/);
    // The navbar repeats it.
    expect(sheet).toMatch(/\.grav-gradient\s*\{[^}]*background:\s*var\(--grav-gradient\)/);
    // ...and Vuetify's own background must get out of the way, or the gradient
    // is flattened to a single grey and nobody notices until they look.
    expect(sheet).toMatch(
      /html \.v-application,\s*html \.v-main\s*\{[^}]*background:\s*transparent/,
    );
  });

  it('carries the stage ink with it, so a navbar painted with it stays legible', () => {
    // Caught in the browser, not in review: an app bar is a `surface`
    // component, so it takes the WHITE card's dark-grey ink. Paint the gradient
    // on one without this and the nav items are charcoal on charcoal.
    expect(css('gravinero.css')).toMatch(
      /\.grav-gradient\s*\{[^}]*color:\s*rgb\(var\(--v-theme-on-background\)\)/s,
    );
  });

  it('rebinds on-background inside cards, or Vuetify hides its own captions', () => {
    // ⚠️ Vuetify 4's `text-high-emphasis` / `text-medium-emphasis` / `text-disabled`
    // resolve against `--v-theme-on-background`, NEVER `on-surface`. In an
    // ordinary theme the two are the same tone; in this mixed one they are
    // opposites, so a caption inside a card came out white on white. Verified
    // against `vuetify/lib/styles/utilities.css` — if that ever switches to
    // `on-surface`, this rebinding becomes a no-op rather than a bug.
    expect(css('gravinero.css')).toMatch(
      /\.v-card,\s*\.v-list,\s*\.v-table\s*\{\s*--v-theme-on-background:\s*var\(--v-theme-on-surface\)/s,
    );
  });

  it('keeps the footer credit dim rather than letting the stage link rule win', () => {
    // Equal specificity, decided by order — so the selector shape matters.
    // Written as a bare `.grav-footer a` the credit line came out bright red.
    expect(css('gravinero.css')).toMatch(
      /\.grav-footer a:not\(\[class\*='v-'\]\)\s*\{[^}]*var\(--grav-footer-link\)/s,
    );
  });
});

describe('the title treatment', () => {
  const STYLE_ID = 'grav-test-styles';

  beforeAll(() => {
    stubBrowserApis();
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css('gravinero.css');
    document.head.appendChild(style);
  });

  it('degrades to a real condensed stack when the webfont never loads', () => {
    // jsdom loads no webfonts at all, which is precisely the scenario: Typekit
    // is third-party, render-blocking and cross-origin, and the app has to read
    // correctly when it does not answer.
    const wrapper = mount(GravTitle, {
      global: { plugins: [vuetify] },
      props: { level: 1 },
      slots: { default: 'Índice gravinero' },
    });

    const el = wrapper.element as HTMLElement;
    document.body.appendChild(el);
    const computed = getComputedStyle(el);

    const families = computed.fontFamily
      .split(',')
      .map((f) => f.trim().replace(/^['"]|['"]$/g, ''));

    // Typekit's family name first, then the same typeface's name when installed
    // locally or self-hosted from the OFL original — so a future switch to
    // `@fontsource/league-gothic` needs no CSS change.
    expect(families[0]).toBe('league-gothic');
    expect(families[1]).toBe('League Gothic');
    // Then real, shipped-with-an-OS condensed grotesques — not a bare
    // `sans-serif`, the fallback that turns every title into body copy when a web
    // font fails to load.
    expect(families).toContain('Arial Narrow');
    expect(families).toContain('Liberation Sans Narrow');
    expect(families.length).toBeGreaterThanOrEqual(5);
    expect(families.at(-1)).toBe('sans-serif');

    // The uppercase is the stylesheet's, not the copy's: the Spanish strings
    // stay written in sentence case.
    expect(computed.textTransform).toBe('uppercase');
    expect(computed.textShadow).toBe('2px 2px 1px #000');
    expect(computed.fontWeight).toBe('400');

    expect(el.tagName).toBe('H1');
    expect(el.className).toContain('grav-title');

    el.remove();
    wrapper.unmount();
  });

  it('never self-hosts the font — no @font-face for league-gothic anywhere', () => {
    // The licence finding, made mechanical. league-gothic is SIL OFL 1.1 at
    // source, but these files arrive through Adobe Fonts, whose terms forbid
    // mirroring what `use.typekit.net` serves. Self-hosting is a deliberate
    // future step (`@fontsource/league-gothic`), never an accident.
    for (const file of ['gravinero.css', 'transitions.css', 'glitch.css']) {
      expect(code(file)).not.toMatch(/@font-face/i);
    }
  });

  it('keeps the spelled-out title treatment and its tokens in step', () => {
    // `.grav-title` writes the stack and the shadow out in full rather than
    // through `var()`, so that the test above can observe them. That buys
    // observability at the cost of duplication — this is the guard on it.
    const sheet = code('gravinero.css');
    const normalise = (value: string) => value.replace(/\s+/g, ' ').trim();
    const rule = /\.grav-title\s*\{([\s\S]*?)\}/.exec(sheet)?.[1] ?? '';
    expect(rule).not.toBe('');

    const fontToken = /--grav-font-title:\s*([^;]+);/.exec(sheet)?.[1] ?? '';
    const fontRule = /font-family:\s*([^;]+);/.exec(rule)?.[1] ?? '';
    expect(normalise(fontToken)).not.toBe('');
    expect(normalise(fontRule)).toBe(normalise(fontToken));

    const shadowToken = /--grav-title-shadow:\s*([^;]+);/.exec(sheet)?.[1] ?? '';
    const shadowRule = /text-shadow:\s*([^;]+);/.exec(rule)?.[1] ?? '';
    expect(normalise(shadowToken)).toBe('2px 2px 1px #000');
    expect(normalise(shadowRule)).toBe(normalise(shadowToken));
  });

  it('turns red and drops its shadow inside a card, as it always did', () => {
    expect(css('gravinero.css')).toMatch(
      /\.v-card \.grav-title\s*\{[^}]*color:\s*rgb\(var\(--v-theme-primary\)\)[^}]*text-shadow:\s*none/s,
    );
  });
});

describe('the reusable primitives the theme provides', () => {
  const sheet = css('gravinero.css');

  it('stretches a card to its column and pushes the actions to the bottom', () => {
    expect(sheet).toMatch(/\.v-col > \.v-card,\s*\.grav-card\s*\{[^}]*height:\s*100%/s);
    expect(sheet).toMatch(/\.v-col > \.v-card,\s*\.grav-card\s*\{[^}]*flex-direction:\s*column/s);
    expect(sheet).toMatch(/\.v-card-actions,[\s\S]{0,60}\{[^}]*margin-top:\s*auto/);
  });

  it('keeps the dark-inset form controls under their class name', () => {
    // `.control-graviner`, misspelling included: the class name stays as it is.
    expect(sheet).toContain('.control-graviner');
    expect(sheet).toMatch(/\.control-graviner \.v-field\s*\{[^}]*var\(--grav-field-bg\)/s);
    expect(sheet).toMatch(/\.control-graviner[^{]*\.v-icon[^{]*\{[^}]*var\(--grav-brown\)/s);
  });

  it('leaves button labels in sentence case — the shouting belongs to the titles', () => {
    expect(sheet).toMatch(/\.v-btn\s*\{[^}]*text-transform:\s*none/s);
  });

  /**
   * ⚠️ **The `@layer` trap, made mechanical.** Vuetify 4 ships its component CSS
   * inside an `@layer`, and an UNLAYERED rule beats a layered one at ANY
   * specificity — `!important` included. So a global `button { … }` reset, which
   * is the obvious way to make the bare `<button>` controls look like the
   * design, silently flattened every `<v-btn>` and every
   * `<v-chip tag="button">` in the app: the admin login's "Entrar" lost its red
   * fill and a clip's tag chips lost theirs. Nothing threw. Nothing looked
   * broken enough to notice in the screen being worked on.
   *
   * The same guard the stage's link rule carries, for the same reason.
   */
  it('never resets a Vuetify element from outside its layer', () => {
    const bare = /(^|\})\s*(button|input|a|select|textarea)\s*\{/;
    expect(bare.test(sheet)).toBe(false);

    expect(sheet).toMatch(/button:not\(\[class\*='v-'\]\)\s*\{/);
  });

  /**
   * ⚠️ The stage's link colour is scoped to PROSE, and it has to be. The old
   * rule — every bare `<a>` under `.v-main` — was right when the app was white
   * cards on a dark ground and almost every such link really was a sentence.
   * A link is the normal case here (a row's title, its episode, the
   * player's title, the queue pill), and every one of them came out bright red
   * because that selector outranks a scoped component rule.
   */
  it('paints only prose links with the stage red', () => {
    expect(sheet).toMatch(/\.v-main :where\(p, li, td\) a:not\(\[class\*='v-'\]\)/);
    expect(sheet).not.toMatch(/\.v-main a:not\(\[class\*='v-'\]\)\s*\{/);
  });
});

describe('the glitch effect', () => {
  const sheet = code('glitch.css');

  it('exists as CSS, with both noise animations and the full keyframe ladder', () => {
    expect(sheet).toContain('@keyframes noise-anim {');
    expect(sheet).toContain('@keyframes noise-anim-2 {');

    // Twenty-one stops, five percent apart, per animation.
    const blocks = sheet.split('@keyframes ').slice(1);
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      const stops = [...block.matchAll(/^\s*([\d.]+)% \{$/gm)].map((m) => Number(m[1]));
      expect(stops).toHaveLength(21);
      expect(stops[0]).toBe(0);
      expect(stops.at(-1)).toBe(100);
      expect(stops).toEqual([...stops].sort((a, b) => a - b));
    }

    // The two offset copies of the text.
    expect(sheet).toMatch(
      /\.glitch::before,\s*\.glitch::after\s*\{[^}]*content:\s*attr\(data-text\)/s,
    );
    expect(sheet).toMatch(/animation:\s*noise-anim 2s infinite linear alternate-reverse/);
    expect(sheet).toMatch(/animation:\s*noise-anim-2 3s infinite linear alternate-reverse/);
  });

  it('needs no preprocessor at all — the Sass division is gone', () => {
    // Dart Sass 2 rejects the slash division this table was once generated with.
    // There is no `sass` in the lockfile, so the only proof that survives is that
    // nothing here needs one.
    expect(sheet).not.toMatch(/percentage\(/);
    expect(sheet).not.toMatch(/math\.div/);
    expect(sheet).not.toMatch(/@for\b/);
    expect(sheet).not.toMatch(/\$[a-zA-Z]/);
    // ...and the `random()` it used is baked, so the frames are constants.
    expect(sheet).not.toMatch(/random\(/);
    expect([...sheet.matchAll(/clip: rect\(\d+px, 9999px, \d+px, 0\);/g)]).toHaveLength(42);
  });
});

describe('the route transition', () => {
  it('uses the Vue 3 transition class names', () => {
    const sheet = css('transitions.css');
    expect(sheet).toContain('.component-fade-enter-from');
    expect(sheet).toContain('.component-fade-leave-from');
    // `.x-enter` / `.x-leave` were renamed in Vue 3. Left behind, the fade
    // still "works" — it just skips its first frame.
    expect(sheet).not.toMatch(/\.component-fade-enter\s*[,{]/);
    expect(sheet).not.toMatch(/\.component-fade-leave\s*[,{]/);
    expect(sheet).toMatch(/transition:\s*opacity 0\.3s ease/);
  });
});

describe('the palette is defined once', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return walk(path);
      return /\.(vue|ts|css)$/.test(entry) ? [path] : [];
    });
  }

  it('mirrors every TypeScript token as a --grav-* custom property', () => {
    // CSS cannot import from TypeScript, so `gravinero.css` restates the hexes.
    // This is the guard that keeps the two halves the same colour.
    const sheet = css('gravinero.css');
    const pairs: [string, string][] = [
      ['--grav-red', GRAVINERO.red],
      ['--grav-brown', GRAVINERO.brown],
      ['--grav-stage-edge', GRAVINERO.stageEdge],
      ['--grav-stage-centre', GRAVINERO.stageCentre],
      ['--grav-stage-ink', GRAVINERO.stageInk],
      ['--grav-field-bg', GRAVINERO.fieldBg],
      ['--grav-field-ink', GRAVINERO.fieldInk],
      ['--grav-field-border', GRAVINERO.fieldBorder],
      ['--grav-link', GRAVINERO.link],
      ['--grav-link-hover', GRAVINERO.linkHover],
      ['--grav-footer-ink', GRAVINERO.footerInk],
      ['--grav-card-rule', GRAVINERO.cardRule],
    ];
    for (const [prop, hex] of pairs) {
      expect(sheet).toContain(`${prop}: ${hex};`);
    }
  });

  it('keeps the brand hexes out of every component and view', () => {
    // "Do not scatter raw hex values through components." A drift guard rather
    // than a convention, because the convention is invisible when broken: a
    // hard-coded `#9a1d0d` looks perfect until the token moves.
    const offenders = walk(VUE_DIR)
      .filter((path) => !path.startsWith(THEME_DIR))
      .filter((path) => /#9a1d0d|#dcc08e/i.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

afterEach(() => {
  document.body.innerHTML = '';
});
