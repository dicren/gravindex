import { onBeforeUnmount, readonly, ref, type Ref } from 'vue';

/**
 * The design's single breakpoint, in one place.
 *
 * ⚠️ **720 px, and the same number everywhere**. The mockups drove it with
 * container queries so the frames could be shown at any size; in the app it is
 * the viewport, and the rule is
 * that the number does not vary by component.
 */
export const COMPACT_BREAKPOINT_PX = 720;

/**
 * Whether the viewport is at or below the design's breakpoint.
 *
 * ⚠️ **Why this exists at all, when CSS could hide one of two layouts.** The
 * filter rail and the mobile sheet hold the SAME controls, so rendering both and
 * hiding one puts every one of the 102 tag checkboxes in the document twice.
 * That is invisible to a sighted visitor and very visible to a screen reader,
 * which reads the hidden copy too unless it happens to be `display: none` at
 * exactly the right moment — and it doubles the work of every keyboard `Tab`
 * through the filters. One layout in the DOM at a time is the honest version.
 *
 * ⚠️ `matchMedia` may be absent (jsdom without a stub, a very old browser); the
 * fallback is the WIDE layout, which is the one that degrades gracefully — a
 * phone showing the desktop rail is cramped, a desktop showing only the mobile
 * sheet has lost its filters behind a button for no reason.
 */
export function useCompactLayout(): Readonly<Ref<boolean>> {
  const compact = ref(false);

  const query = globalThis.matchMedia?.(`(max-width: ${COMPACT_BREAKPOINT_PX}px)`);
  if (query === undefined) return readonly(compact);

  compact.value = query.matches;
  const onChange = (event: MediaQueryListEvent): void => {
    compact.value = event.matches;
  };

  // ⚠️ `addEventListener`, with `addListener` as a fallback for Safari versions
  // that lack the modern form on `MediaQueryList` (before 14).
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', onChange);
    onBeforeUnmount(() => query.removeEventListener('change', onChange));
  } else if (typeof query.addListener === 'function') {
    query.addListener(onChange);
    onBeforeUnmount(() => query.removeListener(onChange));
  }

  return readonly(compact);
}
