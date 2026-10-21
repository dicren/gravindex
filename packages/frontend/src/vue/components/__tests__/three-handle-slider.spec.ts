import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import ThreeHandleSlider from '@/components/ThreeHandleSlider.vue';
import { isOrdered, type HandleIndex, type SliderValues } from '@/utils/slider-logic';

/**
 * The three-handle timeline, driven by real DOM events.
 *
 * ⚠️ `@vue/test-utils`' `trigger()` assigns its option object onto the event
 * *after* constructing it, which throws for `clientX` / `key` because those are
 * getter-only on the `MouseEvent` / `KeyboardEvent` prototypes. So these specs
 * build and dispatch real events instead — closer to the browser anyway.
 */

/**
 * ⚠️ jsdom 30 ships a real `PointerEvent` (it honours `clientX` and `pointerId`)
 * but implements **none** of the Pointer Capture API — `setPointerCapture` is
 * simply absent. Without it every drag would exercise the component's
 * "not capturable" branch and never the real one. This fakes only the API;
 * jsdom cannot retarget events, which is why the specs dispatch
 * pointermove/pointerup on the track itself.
 */
const captured = new WeakMap<Element, Set<number>>();

beforeAll(() => {
  if (typeof Element.prototype.setPointerCapture === 'function') return;
  Element.prototype.setPointerCapture = function (this: Element, id: number) {
    const set = captured.get(this) ?? new Set<number>();
    set.add(id);
    captured.set(this, set);
  };
  Element.prototype.releasePointerCapture = function (this: Element, id: number) {
    captured.get(this)?.delete(id);
  };
  Element.prototype.hasPointerCapture = function (this: Element, id: number) {
    return captured.get(this)?.has(id) ?? false;
  };
});

/** Track geometry used by every test: 800 px wide, starting at x = 100. */
const LEFT = 100;
const WIDTH = 800;
const DURATION = 1000;

function fakeRect(): DOMRect {
  return {
    left: LEFT,
    width: WIDTH,
    right: LEFT + WIDTH,
    top: 0,
    bottom: 12,
    height: 12,
    x: LEFT,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

/** value -> clientX, given the fake rect and the current window. */
function xFor(value: number, min = 0, max = DURATION): number {
  return LEFT + ((value - min) / (max - min)) * WIDTH;
}

interface PointerOpts {
  clientX: number;
  button?: number;
  pointerId?: number;
  pointerType?: string;
}

async function firePointer(el: Element, type: string, opts: PointerOpts): Promise<void> {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: opts.clientX,
      button: opts.button ?? 0,
      pointerId: opts.pointerId ?? 1,
      pointerType: opts.pointerType ?? 'mouse',
      isPrimary: true,
    }),
  );
  await nextTick();
  await nextTick();
}

async function fireKey(el: Element, key: string, shiftKey = false): Promise<void> {
  el.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, shiftKey }),
  );
  await nextTick();
  await nextTick();
}

interface Harness {
  wrapper: VueWrapper;
  track: HTMLElement;
  handles: HTMLElement[];
  /** The live value, kept in sync the way a real parent's `v-model` would. */
  current: () => SliderValues;
  nudgeActive: (delta: number) => void;
}

const mounted: VueWrapper[] = [];

function mountSlider(
  initial: SliderValues = [200, 400, 600],
  props: { min?: number; max?: number; step?: number; disabled?: boolean } = {},
): Harness {
  let current: SliderValues = initial;

  const wrapper = mount(ThreeHandleSlider, {
    props: {
      modelValue: initial,
      min: props.min ?? 0,
      max: props.max ?? DURATION,
      step: props.step ?? 1,
      disabled: props.disabled ?? false,
      'onUpdate:modelValue': (value: SliderValues) => {
        current = value;
        void wrapper.setProps({ modelValue: value });
      },
    },
    attachTo: document.body,
  });
  mounted.push(wrapper);

  const track = wrapper.find('.ths__track').element as HTMLElement;
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue(fakeRect());

  const handles = wrapper.findAll('[role="slider"]').map((w) => w.element as HTMLElement);
  const vm = wrapper.vm as unknown as { nudgeActive: (delta: number) => void };

  return { wrapper, track, handles, current: () => current, nudgeActive: vm.nudgeActive };
}

async function drag(h: Harness, fromX: number, path: number[], pointerId = 1): Promise<void> {
  await firePointer(h.track, 'pointerdown', { clientX: fromX, pointerId });
  for (const x of path) await firePointer(h.track, 'pointermove', { clientX: x, pointerId });
  await firePointer(h.track, 'pointerup', { clientX: path.at(-1) ?? fromX, pointerId });
}

function handle(h: Harness, i: HandleIndex): HTMLElement {
  const el = h.handles[i];
  if (el === undefined) throw new Error(`no handle ${i}`);
  return el;
}

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount();
  document.body.innerHTML = '';
});

describe('rendering and ARIA', () => {
  it('renders three focusable slider handles', () => {
    const h = mountSlider();
    expect(h.handles).toHaveLength(3);
    for (const el of h.handles) {
      expect(el.getAttribute('role')).toBe('slider');
      expect(el.getAttribute('tabindex')).toBe('0');
      expect(el.getAttribute('aria-orientation')).toBe('horizontal');
      expect(el.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('labels the three handles distinctly, in Spanish', () => {
    const h = mountSlider();
    const labels = h.handles.map((el) => el.getAttribute('aria-label'));
    expect(new Set(labels).size).toBe(3);
    expect(labels[0]).toMatch(/inicio/i);
    expect(labels[2]).toMatch(/final/i);
  });

  it('reports aria-valuenow and an hh:mm:ss aria-valuetext', () => {
    const h = mountSlider([200, 400, 3661], { max: 5000 });
    expect(handle(h, 0).getAttribute('aria-valuenow')).toBe('200');
    expect(handle(h, 0).getAttribute('aria-valuetext')).toBe('00:03:20');
    expect(handle(h, 2).getAttribute('aria-valuetext')).toBe('01:01:01');
  });

  it('bounds aria-valuemin/max by the neighbouring handles, not the whole range', () => {
    const h = mountSlider([200, 400, 600]);
    expect(handle(h, 0).getAttribute('aria-valuemin')).toBe('0');
    expect(handle(h, 0).getAttribute('aria-valuemax')).toBe('400');
    expect(handle(h, 1).getAttribute('aria-valuemin')).toBe('200');
    expect(handle(h, 1).getAttribute('aria-valuemax')).toBe('600');
    expect(handle(h, 2).getAttribute('aria-valuemin')).toBe('400');
    expect(handle(h, 2).getAttribute('aria-valuemax')).toBe('1000');
  });

  it('positions handles as a percentage of the visible window', () => {
    const h = mountSlider([200, 400, 600]);
    expect(handle(h, 0).style.left).toBe('20%');
    expect(handle(h, 1).style.left).toBe('40%');
    expect(handle(h, 2).style.left).toBe('60%');
  });
});

describe('pointer dragging', () => {
  it('moves the grabbed handle and the value follows the pointer', async () => {
    const h = mountSlider([200, 400, 600]);
    await drag(h, xFor(200), [xFor(250), xFor(300)]);
    expect(h.current()).toEqual([300, 400, 600]);
  });

  it('emits update:modelValue continuously and change once, on release', async () => {
    const h = mountSlider([200, 400, 600]);
    await drag(h, xFor(200), [xFor(250), xFor(300)]);
    expect((h.wrapper.emitted('update:modelValue') ?? []).length).toBeGreaterThanOrEqual(2);
    expect(h.wrapper.emitted('change')).toHaveLength(1);
    expect(h.wrapper.emitted('drag-start')).toHaveLength(1);
    expect(h.wrapper.emitted('drag-end')).toHaveLength(1);
  });

  it('works for a touch pointer, not just a mouse', async () => {
    const h = mountSlider([200, 400, 600]);
    await firePointer(h.track, 'pointerdown', {
      clientX: xFor(600),
      pointerId: 7,
      pointerType: 'touch',
    });
    await firePointer(h.track, 'pointermove', {
      clientX: xFor(700),
      pointerId: 7,
      pointerType: 'touch',
    });
    expect(h.current()).toEqual([200, 400, 700]);
  });

  it('captures the pointer on the track so the drag survives leaving the thumb', async () => {
    const h = mountSlider([200, 400, 600]);
    const capture = vi.spyOn(h.track, 'setPointerCapture');
    const release = vi.spyOn(h.track, 'releasePointerCapture');
    await drag(h, xFor(400), [xFor(450)]);
    expect(capture).toHaveBeenCalledWith(1);
    expect(release).toHaveBeenCalledWith(1);
  });

  it('still drags when setPointerCapture throws', async () => {
    // ⚠️ Chrome raises NotFoundError when the pointer id is not an active
    // pointer (synthesised events, very fast taps). Capture is an optimisation;
    // losing it must not abort the interaction. Caught in a real browser, where
    // it aborted the initial tap — never here.
    const h = mountSlider([200, 400, 600]);
    vi.spyOn(h.track, 'setPointerCapture').mockImplementation(() => {
      throw new DOMException('No active pointer with the given id is found.', 'NotFoundError');
    });
    await drag(h, xFor(200), [xFor(300)]);
    expect(h.current()).toEqual([300, 400, 600]);
    expect(h.wrapper.emitted('drag-start')).toHaveLength(1);
    expect(h.wrapper.emitted('drag-end')).toHaveLength(1);
  });

  it('still releases cleanly when releasePointerCapture throws', async () => {
    const h = mountSlider([200, 400, 600]);
    vi.spyOn(h.track, 'releasePointerCapture').mockImplementation(() => {
      throw new DOMException('boom', 'NotFoundError');
    });
    await drag(h, xFor(200), [xFor(300)]);
    expect(h.wrapper.emitted('drag-end')).toHaveLength(1);
    expect(h.current()).toEqual([300, 400, 600]);
  });

  it('keeps tracking when the pointer runs off the end of the track', async () => {
    const h = mountSlider([200, 400, 600]);
    await drag(h, xFor(600), [LEFT + WIDTH + 5000]);
    expect(h.current()).toEqual([200, 400, DURATION]);
  });

  it('stops on pointercancel, as a browser does when a scroll takes over', async () => {
    const h = mountSlider([200, 400, 600]);
    await firePointer(h.track, 'pointerdown', { clientX: xFor(600) });
    await firePointer(h.track, 'pointercancel', { clientX: xFor(700) });
    await firePointer(h.track, 'pointermove', { clientX: xFor(900) });
    expect(h.current()).toEqual([200, 400, 600]);
  });

  it('focuses the grabbed handle, so the keyboard picks up where the drag left off', async () => {
    const h = mountSlider([200, 400, 600]);
    await firePointer(h.track, 'pointerdown', { clientX: xFor(400) });
    expect(document.activeElement).toBe(handle(h, 1));
    expect(h.wrapper.emitted('update:activeHandle')?.at(-1)).toEqual([1]);
  });

  it('taps: pressing empty track moves the nearest handle there', async () => {
    const h = mountSlider([200, 400, 600]);
    await firePointer(h.track, 'pointerdown', { clientX: xFor(210) });
    expect(h.current()).toEqual([210, 400, 600]);
  });

  it('ignores non-primary buttons', async () => {
    const h = mountSlider([200, 400, 600]);
    await firePointer(h.track, 'pointerdown', { clientX: xFor(900), button: 2 });
    expect(h.current()).toEqual([200, 400, 600]);
  });

  it('ignores a pointermove that is not part of a drag', async () => {
    const h = mountSlider([200, 400, 600]);
    await firePointer(h.track, 'pointermove', { clientX: xFor(900) });
    expect(h.current()).toEqual([200, 400, 600]);
  });

  it('does nothing when disabled', async () => {
    const h = mountSlider([200, 400, 600], { disabled: true });
    await drag(h, xFor(200), [xFor(300)]);
    expect(h.current()).toEqual([200, 400, 600]);
    expect(handle(h, 0).getAttribute('tabindex')).toBe('-1');
  });
});

describe('the ordering invariant under drag', () => {
  it('stops `start` at the playhead instead of crossing it', async () => {
    const h = mountSlider([200, 400, 600]);
    await drag(h, xFor(200), [xFor(350), xFor(500), xFor(900)]);
    expect(h.current()).toEqual([400, 400, 600]);
    expect(isOrdered(h.current())).toBe(true);
  });

  it('stops `end` at the playhead instead of crossing it', async () => {
    const h = mountSlider([200, 400, 600]);
    await drag(h, xFor(600), [xFor(500), xFor(0)]);
    expect(h.current()).toEqual([200, 400, 400]);
    expect(isOrdered(h.current())).toBe(true);
  });

  it('stops the playhead at each neighbour in turn', async () => {
    const h = mountSlider([200, 400, 600]);
    await drag(h, xFor(400), [xFor(900)]);
    expect(h.current()).toEqual([200, 600, 600]);
    // The playhead now sits on `end`; pressing to the left of the pair hands it
    // to the lower index, i.e. the playhead, which is the one with room.
    await drag(h, xFor(590), [xFor(0)]);
    expect(h.current()).toEqual([200, 200, 600]);
  });

  it('never breaks ordering across a long noisy drag', async () => {
    const h = mountSlider([200, 400, 600]);
    await firePointer(h.track, 'pointerdown', { clientX: xFor(400) });
    for (let i = 0; i < 60; i += 1) {
      await firePointer(h.track, 'pointermove', { clientX: xFor(500 + Math.sin(i) * 700) });
      expect(isOrdered(h.current())).toBe(true);
    }
    await firePointer(h.track, 'pointerup', { clientX: xFor(500) });
    expect(isOrdered(h.current())).toBe(true);
  });
});

describe('collapsed handles: which one wins', () => {
  it('hands a press on the left of a fully collapsed slider to `start`', async () => {
    const h = mountSlider([500, 500, 500]);
    await drag(h, xFor(300), [xFor(100)]);
    expect(h.current()).toEqual([100, 500, 500]);
  });

  it('hands a press on the right of a fully collapsed slider to `end`', async () => {
    const h = mountSlider([500, 500, 500]);
    await drag(h, xFor(700), [xFor(900)]);
    expect(h.current()).toEqual([500, 500, 900]);
  });

  it('cannot deadlock: a collapsed slider can always be pulled apart both ways', async () => {
    const h = mountSlider([500, 500, 500]);
    await drag(h, xFor(400), [xFor(100)]);
    await drag(h, xFor(600), [xFor(900)]);
    expect(h.current()).toEqual([100, 500, 900]);
  });

  it('gives an exact press on a collapsed cluster to the lower index', async () => {
    const h = mountSlider([500, 500, 500]);
    await firePointer(h.track, 'pointerdown', { clientX: xFor(500) });
    expect(h.wrapper.emitted('drag-start')?.at(-1)).toEqual([0]);
  });

  it('resolves a collapsed start+playhead by direction of travel', async () => {
    const h = mountSlider([400, 400, 800]);
    await drag(h, xFor(450), [xFor(600)]);
    expect(h.current()).toEqual([400, 600, 800]);
  });

  it('keeps the grabbed handle for the whole drag, even after it passes another', async () => {
    const h = mountSlider([100, 500, 900]);
    // Grab `start` and drive it right past where the playhead sits; the drag
    // must not silently hand over to the handle now nearest the pointer.
    await firePointer(h.track, 'pointerdown', { clientX: xFor(100) });
    await firePointer(h.track, 'pointermove', { clientX: xFor(700) });
    expect(h.current()).toEqual([500, 500, 900]);
    await firePointer(h.track, 'pointermove', { clientX: xFor(300) });
    expect(h.current()).toEqual([300, 500, 900]);
    await firePointer(h.track, 'pointerup', { clientX: xFor(300) });
  });
});

describe('keyboard', () => {
  it('moves by one step on arrow keys', async () => {
    const h = mountSlider([200, 400, 600]);
    await fireKey(handle(h, 1), 'ArrowRight');
    expect(h.current()).toEqual([200, 401, 600]);
    await fireKey(handle(h, 1), 'ArrowLeft');
    expect(h.current()).toEqual([200, 400, 600]);
  });

  it('treats ArrowUp/ArrowDown as increase/decrease', async () => {
    const h = mountSlider([200, 400, 600]);
    await fireKey(handle(h, 1), 'ArrowUp');
    expect(h.current()[1]).toBe(401);
    await fireKey(handle(h, 1), 'ArrowDown');
    expect(h.current()[1]).toBe(400);
  });

  it('uses the ±5 and ±10 shortcuts of the nudge buttons', async () => {
    const h = mountSlider([200, 400, 600]);
    await fireKey(handle(h, 1), 'ArrowRight', true);
    expect(h.current()[1]).toBe(405);
    await fireKey(handle(h, 1), 'PageUp');
    expect(h.current()[1]).toBe(415);
    await fireKey(handle(h, 1), 'PageDown');
    expect(h.current()[1]).toBe(405);
  });

  it('jumps to its own bounds with Home and End', async () => {
    const h = mountSlider([200, 400, 600]);
    await fireKey(handle(h, 1), 'Home');
    expect(h.current()).toEqual([200, 200, 600]);
    await fireKey(handle(h, 1), 'End');
    expect(h.current()).toEqual([200, 600, 600]);
  });

  it('cannot cross a neighbour, however many times you press', async () => {
    const h = mountSlider([200, 400, 405]);
    for (let i = 0; i < 20; i += 1) {
      await fireKey(handle(h, 1), 'ArrowRight');
      expect(isOrdered(h.current())).toBe(true);
    }
    expect(h.current()).toEqual([200, 405, 405]);
  });

  it('cannot leave the visible range', async () => {
    const h = mountSlider([2, 400, 600]);
    for (let i = 0; i < 5; i += 1) await fireKey(handle(h, 0), 'ArrowLeft');
    expect(h.current()[0]).toBe(0);
  });

  it('ignores keys it does not own', async () => {
    const h = mountSlider([200, 400, 600]);
    await fireKey(handle(h, 1), 'a');
    expect(h.current()).toEqual([200, 400, 600]);
    expect(h.wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('emits change on every key press, since a key press is a settled edit', async () => {
    const h = mountSlider([200, 400, 600]);
    await fireKey(handle(h, 1), 'ArrowRight');
    expect(h.wrapper.emitted('change')).toHaveLength(1);
  });

  it('marks the focused handle active so an external nudge targets it', async () => {
    const h = mountSlider([200, 400, 600]);
    handle(h, 2).focus();
    await nextTick();
    expect(h.wrapper.emitted('update:activeHandle')?.at(-1)).toEqual([2]);
  });

  it('does not move a disabled slider', async () => {
    const h = mountSlider([200, 400, 600], { disabled: true });
    await fireKey(handle(h, 1), 'ArrowRight');
    expect(h.current()).toEqual([200, 400, 600]);
  });
});

describe('zoom via a reactive range', () => {
  it('re-maps positions without remounting the component', async () => {
    // ⚠️ The slider is not rebuilt on zoom: a rebuild would throw away focus,
    // tooltips and any in-flight interaction.
    const h = mountSlider([200, 400, 600]);
    const before = h.wrapper.find('.ths__track').element;
    expect(handle(h, 1).style.left).toBe('40%');

    await h.wrapper.setProps({ min: 300, max: 500 });
    await nextTick();

    expect(h.wrapper.find('.ths__track').element).toBe(before);
    expect(handle(h, 1).style.left).toBe('50%');
  });

  it('re-clamps values that fall outside the new window, keeping them ordered', async () => {
    const h = mountSlider([200, 400, 600]);
    await h.wrapper.setProps({ min: 300, max: 500 });
    await nextTick();
    expect(h.current()).toEqual([300, 400, 500]);
    expect(isOrdered(h.current())).toBe(true);
  });

  it('emits change when a zoom moved a value, so the parent can persist it', async () => {
    const h = mountSlider([200, 400, 600]);
    await h.wrapper.setProps({ min: 300, max: 500 });
    await nextTick();
    expect(h.wrapper.emitted('change')).toHaveLength(1);
  });

  it('stays silent when the zoom moved nothing', async () => {
    const h = mountSlider([200, 400, 600]);
    await h.wrapper.setProps({ min: 100, max: 900 });
    await nextTick();
    expect(h.wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(h.wrapper.emitted('change')).toBeUndefined();
  });

  it('drags against the zoomed window, not the original one', async () => {
    const h = mountSlider([200, 400, 600]);
    await h.wrapper.setProps({ min: 300, max: 500 });
    await nextTick();
    // Mid-track is now 400, not 500.
    await drag(h, xFor(400, 300, 500), [xFor(450, 300, 500)]);
    expect(h.current()[1]).toBe(450);
  });

  it('survives zooming to a window narrower than the selection', async () => {
    const h = mountSlider([200, 400, 600]);
    await h.wrapper.setProps({ min: 700, max: 750 });
    await nextTick();
    expect(h.current()).toEqual([700, 700, 700]);
    expect(isOrdered(h.current())).toBe(true);
    // …and is still pullable apart afterwards.
    await drag(h, xFor(740, 700, 750), [xFor(750, 700, 750)]);
    expect(h.current()).toEqual([700, 700, 750]);
  });

  it('flags a handle pinned outside the window instead of hiding the fact', async () => {
    // No v-model wiring here on purpose: a parent that ignores the re-clamp
    // emit must still get a visible signal rather than a silently wrong handle.
    const wrapper = mount(ThreeHandleSlider, {
      props: { modelValue: [200, 400, 600] as SliderValues, min: 300, max: 500, step: 1 },
      attachTo: document.body,
    });
    mounted.push(wrapper);
    await nextTick();
    const start = wrapper.findAll('[role="slider"]')[0]?.element as HTMLElement;
    expect(start.className).toContain('ths__handle--offscreen');
    // …and it is pinned at the edge, not drawn off the track.
    expect(start.style.left).toBe('0%');
  });
});

describe('imperative nudge', () => {
  it('moves whichever handle is active', async () => {
    const h = mountSlider([200, 400, 600]);
    handle(h, 2).focus();
    await nextTick();
    h.nudgeActive(10);
    await nextTick();
    expect(h.current()).toEqual([200, 400, 610]);
    h.nudgeActive(-5);
    await nextTick();
    expect(h.current()).toEqual([200, 400, 605]);
  });

  it('respects the invariant', async () => {
    const h = mountSlider([200, 400, 405]);
    handle(h, 1).focus();
    await nextTick();
    h.nudgeActive(10);
    await nextTick();
    expect(h.current()).toEqual([200, 405, 405]);
  });

  it('defaults to the start handle before anything is focused', async () => {
    const h = mountSlider([200, 400, 600]);
    h.nudgeActive(-10);
    await nextTick();
    expect(h.current()).toEqual([190, 400, 600]);
  });
});
