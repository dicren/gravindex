import { describe, expect, it } from 'vitest';
import { createAppRouter } from '../index';

/**
 * The route table's ambiguous corners.
 *
 * ⚠️ `/episodes/calendario` and `/episodes/:page?` genuinely compete. vue-router
 * ranks the static segment above the parameter, so the calendar wins — but that
 * is a library ranking rule rather than anything written down in the table, and
 * getting it wrong renders the LIST with `page: 'calendario'`, which looks like
 * nothing happened.
 */
describe('the episode routes', () => {
  it('sends /episodes to the list', () => {
    const router = createAppRouter();

    expect(router.resolve('/episodes').name).toBe('episodes');
  });

  it('⚠️ sends /episodes/calendario to the calendar, not to the list', () => {
    const router = createAppRouter();
    const route = router.resolve('/episodes/calendario');

    expect(route.name).toBe('episodesCalendar');
    expect(route.params.year).toBeUndefined();
  });

  it('reads the year out of the path', () => {
    const router = createAppRouter();
    const route = router.resolve('/episodes/calendario/2011');

    expect(route.name).toBe('episodesCalendar');
    expect(route.params.year).toBe('2011');
  });

  it('keeps the filters in the query alongside the calendar path', () => {
    const router = createAppRouter();
    const route = router.resolve('/episodes/calendario/2011?withClips=true&search=zombis');

    expect(route.name).toBe('episodesCalendar');
    expect(route.query).toEqual({ withClips: 'true', search: 'zombis' });
  });

  it('still matches the vestigial page segment for anything else', () => {
    const router = createAppRouter();

    expect(router.resolve('/episodes/3').name).toBe('episodes');
  });
});
