<script setup lang="ts">
/**
 * The infinite-scroll sentinel: `cargando más cortes…` with three pulsing dots.
 * It replaces the paginator entirely.
 *
 * ⚠️ **It is reachable from a keyboard, and that is not optional.** An
 * `IntersectionObserver` fires on scroll and a keyboard user may never scroll —
 * so when the observer is unavailable, or when the visitor tabs to this element,
 * there is a real `Cargar más cortes` button. The design calls it "acceptable
 * and cheap"; it is also the difference between the rest of the list existing
 * and not.
 *
 * ⚠️ **The observer is disconnected while a batch is in flight.** Without that,
 * a sentinel that stays on screen after a short batch fires again immediately
 * and walks the whole list in one go — which is exactly what infinite scroll is
 * for avoiding.
 *
 * ⚠️ `prefers-reduced-motion` stops the dots. They are decoration; the text says
 * the same thing.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    /** Whether there is anything left to load. `false` renders nothing. */
    hasMore: boolean;
    loading?: boolean;
    /** `cortes` / `episodios` — the design writes the noun into the sentinel. */
    noun?: string;
  }>(),
  { loading: false, noun: 'cortes' },
);

const emit = defineEmits<{ load: [] }>();

const sentinel = ref<HTMLElement | null>(null);
/** ⚠️ False when `IntersectionObserver` does not exist, which is what makes the
 *  button the only affordance rather than a second one. */
const observed = ref(false);

let observer: IntersectionObserver | null = null;

function request(): void {
  if (props.loading || !props.hasMore) return;
  emit('load');
}

onMounted(() => {
  if (typeof IntersectionObserver === 'undefined' || sentinel.value === null) return;

  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) request();
    },
    // ⚠️ 400 px of margin: the next batch starts loading before the visitor
    // reaches the end, so the list grows under them instead of stopping first.
    { rootMargin: '400px 0px' },
  );
  observer.observe(sentinel.value);
  observed.value = true;
});

// Stop watching while a batch is loading — see the note above.
watch(
  () => props.loading,
  (loading) => {
    if (observer === null || sentinel.value === null) return;
    if (loading) observer.unobserve(sentinel.value);
    else observer.observe(sentinel.value);
  },
);

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});
</script>

<template>
  <div v-if="props.hasMore" ref="sentinel" class="more">
    <template v-if="props.loading">
      <span class="more__dots" aria-hidden="true"><i /><i /><i /></span>
      <span>cargando más {{ props.noun }}…</span>
    </template>

    <!-- The keyboard path, and the fallback when there is no observer. -->
    <button v-else type="button" class="more__button" @click="request">
      Cargar más {{ props.noun }}
    </button>
  </div>
</template>

<style scoped>
.more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 1.3rem 0 0.3rem;
  font-family: var(--grav-font-mono);
  font-size: 0.75rem;
  color: #b9b2a9;
}

.more__button {
  font-family: var(--grav-font-mono);
  font-size: 0.75rem;
  color: var(--grav-brown);
  border: 1px solid var(--grav-hairline-strong);
  border-radius: 4px;
  padding: 0.35rem 0.9rem;
  cursor: pointer;
}

.more__button:hover,
.more__button:focus-visible {
  border-color: var(--grav-brown);
}

.more__dots {
  display: inline-flex;
  gap: 4px;
}

.more__dots i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--grav-brown);
  animation: more-pulse 1.1s ease-in-out infinite;
}

.more__dots i:nth-child(2) {
  animation-delay: 0.15s;
}

.more__dots i:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes more-pulse {
  0%,
  100% {
    opacity: 0.25;
  }
  50% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .more__dots i {
    animation: none;
    opacity: 0.7;
  }
}
</style>
