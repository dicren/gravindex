import { defineStore } from 'pinia';
import { ref } from 'vue';

/**
 * The tone of a notice. The queue carries a plain level, and the toast component
 * picks the colour from the gravinero theme.
 */
export type NotificationLevel = 'info' | 'success' | 'warning' | 'error';

export interface NotificationItem {
  readonly id: number;
  readonly level: NotificationLevel;
  /**
   * Optional lead-in, rendered emphasised. It exists so the API-error notice
   * can lead with a bold error name, WITHOUT an HTML sink. See the note on
   * `push()`.
   */
  readonly title?: string;
  /** Plain text. Never HTML, never a template — see `push()`. */
  readonly text: string;
  /** `null` keeps it up until something takes it down: a pinned notice. */
  readonly timeoutMs: number | null;
  /** Clicked, therefore kept: the reader is still reading it. */
  readonly pinned: boolean;
  /** When it entered the queue. */
  readonly createdAt: number;
}

/** What a caller passes to `push`. Only `text` is required. */
export interface NotificationInput {
  text: string;
  title?: string;
  level?: NotificationLevel;
  timeoutMs?: number | null;
}

/**
 * ⚠️ 2.5 seconds. Short by most conventions, and kept anyway: pinning is what a
 * reader who needs longer does.
 */
const AUTO_DISMISS_MS = 2_500;

/**
 * Cap on the visible stack. ⚠️ A deliberate limit: nothing else stops a burst
 * (a failing list that retries, a double-click on vote) from covering the
 * screen.
 */
const MAX_VISIBLE = 4;

/**
 * The toast queue. One store, one host component in the app shell, no emitter.
 *
 * ⚠️ **Bodies are plain text. `v-html` is deliberately absent.** API error
 * payloads quote user-submitted values — clip titles and free-text tags typed
 * by anonymous visitors, e.g. the `409 "Tag repeated"` path — so markup in a
 * notice would be a stored-XSS sink for no real benefit. The bold half survives
 * as `title`, rendered as its own element by the toast component; the rest is
 * text and Vue escapes it. No sanitiser is needed because no HTML is accepted,
 * which is the only version of this that cannot regress.
 */
export const useNotificationsStore = defineStore('notifications', () => {
  const items = ref<NotificationItem[]>([]);
  let nextId = 0;

  /** ⚠️ Held so `dismiss` and `pin` can cancel them: a notice taken down early
   *  would otherwise leave a timer that fires against an id nobody holds. */
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  function clearTimer(id: number): void {
    const timer = timers.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    timers.delete(id);
  }

  /**
   * Queue a notice, and answer with its id — which is what a caller that wants
   * to take it down itself needs.
   */
  function push(input: NotificationInput): number {
    const item: NotificationItem = {
      id: ++nextId,
      level: input.level ?? 'info',
      title: input.title,
      text: input.text,
      timeoutMs: input.timeoutMs === undefined ? AUTO_DISMISS_MS : input.timeoutMs,
      pinned: false,
      createdAt: Date.now(),
    };

    // ⚠️ The cap evicts the oldest DISMISSABLE notice. A pinned one is on
    // screen because someone clicked it to keep reading; a burst behind it must
    // not be able to snatch it away.
    const next = [...items.value, item];
    while (next.length > MAX_VISIBLE) {
      const victimIndex = Math.max(
        next.findIndex((other) => !other.pinned && other.timeoutMs !== null),
        0,
      );
      const [victim] = next.splice(victimIndex, 1);
      if (victim) clearTimer(victim.id);
    }
    items.value = next;

    if (item.timeoutMs !== null) {
      timers.set(
        item.id,
        setTimeout(() => dismiss(item.id), item.timeoutMs),
      );
    }
    return item.id;
  }

  /**
   * Click to pin: the notice stops counting down and stays until it is
   * dismissed by hand. A click anywhere on the toast pins it.
   */
  function pin(id: number): void {
    clearTimer(id);
    items.value = items.value.map((item) => (item.id === id ? { ...item, pinned: true } : item));
  }

  /** Take one down — the toast's close button, or whoever raised it. */
  function dismiss(id: number): void {
    clearTimer(id);
    items.value = items.value.filter((item) => item.id !== id);
  }

  /** Empty the queue. */
  function clear(): void {
    for (const item of items.value) clearTimer(item.id);
    items.value = [];
  }

  return { items, push, pin, dismiss, clear };
});
