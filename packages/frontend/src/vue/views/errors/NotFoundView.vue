<script setup lang="ts"></script>

<template>
  <!--
    ⚠️ Copy, markup and class names are kept as they are. The page has no prose at all — it is the glyph "404"
    with the CSS-only glitch effect over it, and that IS the content. Do not
    "improve" it with a friendly Spanish sentence: the empty states in this app
    are jokes someone wrote, and this screen deliberately is not one.

    `.error-page` and `.glitch` (which reads `data-text` in its pseudo-elements)
    belong to the gravinero theme — see `packages/frontend/AGENTS.md`, "The
    gravinero theme is preserved". This view owns no styling of its own so the
    effect keeps living in exactly one place.

    The padding for this page lives on `.error-page`, the hook the theme hangs
    the spacing on.
  -->
  <section class="error-page">
    <div class="error glitch" data-text="404">404</div>
  </section>
</template>
