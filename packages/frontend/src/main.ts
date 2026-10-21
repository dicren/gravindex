import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { PiniaColada } from '@pinia/colada';

import App from '@/App.vue';
import router from '@/router';
import vuetify from '@/plugins/vuetify';

/**
 * The composition entry point, and the only file allowed to reach into every
 * layer (see the `boundaries` policies in `eslint.config.mjs`).
 *
 * ⚠️ Pinia Colada is registered HERE, in the delivery layer, and must never be
 * imported from `core/`. It caches, deduplicates and invalidates *for the UI*;
 * `core/application` use cases stay plain async functions with no framework
 * behind them. The lint boundaries reject a `@pinia/colada` import inside
 * `core/` outright — see `packages/frontend/CLAUDE.md`, "Where Pinia Colada
 * lives".
 */
createApp(App).use(createPinia()).use(PiniaColada).use(router).use(vuetify).mount('#app');
