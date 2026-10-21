import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useNotificationsStore } from '../notifications.store';

// What is pinned here: 2.5 s auto-dismiss, click to pin, no `v-html`, and the
// stack cap.

/** Mirrors the store's own private constant. */
const AUTO_DISMISS_MS = 2_500;

describe('notifications.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => vi.useRealTimers());

  it('starts empty', () => {
    expect(useNotificationsStore().items).toEqual([]);
  });

  it('queues a notice with its text, title and level', () => {
    const store = useNotificationsStore();

    store.push({ level: 'error', title: 'Conflict', text: 'Ese tag ya existe en ese clip.' });

    expect(store.items).toEqual([
      {
        id: 1,
        level: 'error',
        title: 'Conflict',
        text: 'Ese tag ya existe en ese clip.',
        timeoutMs: AUTO_DISMISS_MS,
        pinned: false,
        createdAt: expect.any(Number),
      },
    ]);
  });

  it('defaults the level to info', () => {
    const store = useNotificationsStore();

    store.push({ text: 'Enlace copiado al portapapeles. ¡Comparte la palabra gravinera!' });

    expect(store.items[0]?.level).toBe('info');
  });

  it('gives every notice its own id, even identical ones', () => {
    const store = useNotificationsStore();

    store.push({ text: '¡No puedes votar dos veces!' });
    store.push({ text: '¡No puedes votar dos veces!' });

    expect(store.items.map((item) => item.id)).toEqual([1, 2]);
  });

  it('returns the id, so the caller can take its own notice down', () => {
    const store = useNotificationsStore();

    const id = store.push({ text: 'a' });
    store.dismiss(id);

    expect(store.items).toEqual([]);
  });

  it('auto-dismisses after 2.5s', () => {
    const store = useNotificationsStore();
    store.push({ text: 'a' });

    vi.advanceTimersByTime(AUTO_DISMISS_MS - 1);
    expect(store.items).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(store.items).toEqual([]);
  });

  it('dismisses each notice on its own schedule', () => {
    const store = useNotificationsStore();
    store.push({ text: 'first' });
    vi.advanceTimersByTime(1_000);
    store.push({ text: 'second' });

    vi.advanceTimersByTime(AUTO_DISMISS_MS - 1_000);

    expect(store.items.map((item) => item.text)).toEqual(['second']);
  });

  it('stays up forever with a null timeout', () => {
    const store = useNotificationsStore();

    store.push({ text: 'a', timeoutMs: null });

    vi.advanceTimersByTime(AUTO_DISMISS_MS * 10);
    expect(store.items).toHaveLength(1);
  });

  it('ignores a dismiss for an unknown id', () => {
    const store = useNotificationsStore();
    store.push({ text: 'a' });

    store.dismiss(999);

    expect(store.items).toHaveLength(1);
  });

  it('empties the queue on clear, timers included', () => {
    const store = useNotificationsStore();
    store.push({ text: 'a' });
    store.push({ text: 'b' });

    store.clear();
    vi.advanceTimersByTime(AUTO_DISMISS_MS * 2);

    expect(store.items).toEqual([]);
  });

  describe('click to pin', () => {
    it('keeps a pinned notice up for good', () => {
      const store = useNotificationsStore();
      const id = store.push({ text: 'a' });

      store.pin(id);
      vi.advanceTimersByTime(AUTO_DISMISS_MS * 10);

      expect(store.items).toHaveLength(1);
      expect(store.items[0]?.pinned).toBe(true);
    });

    it('still lets it be dismissed by hand', () => {
      const store = useNotificationsStore();
      const id = store.push({ text: 'a' });

      store.pin(id);
      store.dismiss(id);

      expect(store.items).toEqual([]);
    });

    it('does not touch the others', () => {
      const store = useNotificationsStore();
      const pinned = store.push({ text: 'pinned' });
      store.push({ text: 'transient' });

      store.pin(pinned);
      vi.advanceTimersByTime(AUTO_DISMISS_MS);

      expect(store.items.map((item) => item.text)).toEqual(['pinned']);
    });

    it('ignores a pin for an unknown id', () => {
      const store = useNotificationsStore();
      store.push({ text: 'a' });

      store.pin(999);

      expect(store.items[0]?.pinned).toBe(false);
    });
  });

  describe('the stack cap', () => {
    it('caps the visible stack at 4, dropping the oldest', () => {
      const store = useNotificationsStore();

      for (const text of ['a', 'b', 'c', 'd', 'e', 'f']) store.push({ text });

      expect(store.items.map((item) => item.text)).toEqual(['c', 'd', 'e', 'f']);
    });

    // ⚠️ Someone clicked that one to keep reading it. A burst behind it must not
    // be able to snatch it away.
    it('never evicts a pinned notice', () => {
      const store = useNotificationsStore();
      const id = store.push({ text: 'pinned' });
      store.pin(id);

      for (const text of ['a', 'b', 'c', 'd', 'e']) store.push({ text });

      expect(store.items[0]?.text).toBe('pinned');
      expect(store.items).toHaveLength(4);
    });

    it('does not disturb the stack when an evicted notice was due', () => {
      const store = useNotificationsStore();

      // 'a' is evicted immediately, but its timer is still pending and will fire
      // for an id that is no longer there. Harmless, and pinned as such.
      for (const text of ['a', 'b', 'c', 'd', 'e']) store.push({ text });
      expect(store.items.map((item) => item.text)).toEqual(['b', 'c', 'd', 'e']);

      vi.advanceTimersByTime(AUTO_DISMISS_MS);

      expect(store.items).toEqual([]);
    });
  });

  // ⚠️ Bodies are text, and the store must never grow a field the toast
  // component could feed to `v-html`. API payloads quote user-submitted titles
  // and tags, so they must never be rendered as markup.
  describe('no HTML anywhere', () => {
    it('keeps markup as literal text, and Vue escapes it at render', () => {
      const store = useNotificationsStore();

      store.push({ title: '<img src=x onerror=alert(1)>', text: '<b>bold</b>' });

      expect(store.items[0]?.text).toBe('<b>bold</b>');
      expect(store.items[0]?.title).toBe('<img src=x onerror=alert(1)>');
    });

    it('exposes no html-bearing field at all', () => {
      const store = useNotificationsStore();
      store.push({ text: 'a' });

      expect(Object.keys(store.items[0] ?? {}).sort()).toEqual([
        'createdAt',
        'id',
        'level',
        'pinned',
        'text',
        'timeoutMs',
        'title',
      ]);
    });
  });
});
