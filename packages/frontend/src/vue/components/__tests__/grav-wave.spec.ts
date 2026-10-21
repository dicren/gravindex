import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import GravWave from '@/components/GravWave.vue';

// ⚠️ No Vuetify plumbing needed — this is a plain `<span>`/`<svg>` component,
// not one of Vuetify's. What matters here is measured-vs-placeholder, not
// styling.

function bars(wrapper: ReturnType<typeof mount>) {
  // The FIRST of the two identical `<svg>`s (idle + played) is enough — see
  // `GravWave.vue` for why there are two.
  return wrapper.findAll('svg.grav-wave__svg')[0]?.findAll('rect') ?? [];
}

describe('GravWave', () => {
  it('draws the deterministic placeholder when no peaks are given', () => {
    const wrapper = mount(GravWave, { props: { seed: 42, bars: 16 } });

    expect(bars(wrapper)).toHaveLength(16);

    wrapper.unmount();
  });

  it('draws exactly as many bars as it is given peaks, ignoring `bars`', () => {
    const wrapper = mount(GravWave, {
      props: { peaks: [0, 64, 128, 255, 32], bars: 128 },
    });

    expect(bars(wrapper)).toHaveLength(5);

    wrapper.unmount();
  });

  it('maps a peak byte to a proportional bar height, floored so silence is a thin line', () => {
    const HEIGHT = 40; // matches the component's own constant
    const wrapper = mount(GravWave, { props: { peaks: [0, 255] } });

    const rects = bars(wrapper);
    const silent = Number(rects[0]?.attributes('height'));
    const loudest = Number(rects[1]?.attributes('height'));

    // Silence is a visible floor, not zero — see the component's 0.06 floor.
    expect(silent).toBeCloseTo(HEIGHT * 0.06, 1);
    // The loudest possible byte fills the full height.
    expect(loudest).toBeCloseTo(HEIGHT, 1);

    wrapper.unmount();
  });

  it('produces the SAME shape for the same seed, and a DIFFERENT one for a different seed', () => {
    const first = mount(GravWave, { props: { seed: 7, bars: 32 } });
    const same = mount(GravWave, { props: { seed: 7, bars: 32 } });
    const other = mount(GravWave, { props: { seed: 8, bars: 32 } });

    const heights = (w: ReturnType<typeof mount>) => bars(w).map((r) => r.attributes('height'));

    expect(heights(first)).toEqual(heights(same));
    expect(heights(first)).not.toEqual(heights(other));

    first.unmount();
    same.unmount();
    other.unmount();
  });

  it('falls back to the placeholder when peaks is explicitly empty', () => {
    const wrapper = mount(GravWave, { props: { peaks: [], seed: 3, bars: 10 } });

    expect(bars(wrapper)).toHaveLength(10);

    wrapper.unmount();
  });
});
