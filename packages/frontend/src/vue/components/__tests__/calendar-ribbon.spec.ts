import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { EpisodeListItem } from '#/domain/episodes/episode.entity';
import vuetify from '@/plugins/vuetify';
import { buildCalendar } from '@/composables/use-episode-calendar';
import CalendarRibbon from '@/components/CalendarRibbon.vue';
import { freshPinia, stubBrowserApis } from './mount-with-vuetify';

function episode(id: number, date: Date, clipCount = 0): EpisodeListItem {
  return {
    id,
    title: `Episodio ${id}`,
    cover: 'https://example.test/cover.png',
    file: 'https://example.test/audio.mp3',
    originalUrl: 'https://example.test/episodio',
    date,
    clipCount,
  };
}

/** Three years, with a gap year in the middle and cuts only in the first. */
const CATALOGUE = [
  episode(1, new Date(2009, 3, 12, 12), 2),
  episode(2, new Date(2009, 7, 1, 12)),
  episode(3, new Date(2011, 5, 6, 12)),
  episode(4, new Date(2011, 5, 20, 12)),
];

function mountRibbon(year = 2011) {
  return mount(CalendarRibbon, {
    props: { calendar: buildCalendar(CATALOGUE), year },
    global: { plugins: [vuetify, freshPinia()] },
  });
}

describe('CalendarRibbon', () => {
  beforeEach(stubBrowserApis);

  it('draws a button per year of the catalogue, gap years included', () => {
    const wrapper = mountRibbon();

    const years = wrapper.findAll('.gv__year');
    expect(years).toHaveLength(3);
    expect(years.map((year) => year.attributes('data-year'))).toEqual(['2009', '2010', '2011']);
  });

  it('⚠️ draws a brick per EPISODE, so the strip counts rather than shades', () => {
    const wrapper = mountRibbon();

    expect(wrapper.findAll('.gv__b')).toHaveLength(CATALOGUE.length);
    // The one episode with cuts is the one drawn in the cut colour.
    expect(wrapper.findAll('.gv__b.has-clips')).toHaveLength(1);
  });

  it('stops at the first and last month there is, and fills the years between', () => {
    const wrapper = mountRibbon();

    const [first, middle, last] = wrapper.findAll('.gv__year');
    // 2009 starts in April; 2010 is silent but present in full; 2011 ends in June.
    expect(first?.findAll('.gv__m')).toHaveLength(9);
    expect(middle?.findAll('.gv__m')).toHaveLength(12);
    expect(last?.findAll('.gv__m')).toHaveLength(6);
  });

  it('marks the year on screen, and says what it holds', () => {
    const wrapper = mountRibbon(2009);

    expect(wrapper.find('.gv__year.is-on').attributes('data-year')).toBe('2009');
    expect(wrapper.find('.gv__read').text()).toBe('2009 · 2 episodios · 2 cortes');
  });

  it('asks for a year when one is pressed', async () => {
    const wrapper = mountRibbon(2011);

    await wrapper.findAll('.gv__year')[0]?.trigger('click');

    expect(wrapper.emitted('update:year')).toEqual([[2009]]);
  });

  it('names each year for a screen reader, since the bricks say nothing', () => {
    const wrapper = mountRibbon();

    expect(wrapper.findAll('.gv__year')[0]?.attributes('aria-label')).toBe('2009: 2 episodios');
    expect(wrapper.findAll('.gv__year')[1]?.attributes('aria-label')).toBe('2010: 0 episodios');
  });

  it('reads out the hovered month instead of the year', async () => {
    const wrapper = mountRibbon(2011);

    await wrapper.findAll('.gv__m').at(-1)?.trigger('mouseenter');

    expect(wrapper.find('.gv__read').text()).toBe('junio de 2011 · 2 episodios · sin cortes');
  });
});
