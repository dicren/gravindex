<script setup lang="ts"></script>

<template>
  <!--
    The English text is kept on purpose: the app has said "Unknown error" here
    since 2019, so translating it would be a silent change. See the note in
    `NotFoundView.vue` about where `.glitch` lives.
  -->
  <section class="error-page">
    <div class="error glitch" data-text="Unknown error">Unknown error</div>
  </section>
</template>
