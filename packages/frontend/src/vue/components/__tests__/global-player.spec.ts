import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import vuetify from '@/plugins/vuetify';
import GlobalPlayer from '@/components/GlobalPlayer.vue';
import {
  resetAudioElementFactory,
  setAudioElementFactory,
  usePlaybackStore,
  type PlaybackAudio,
} from '@/stores/playback.store';
import { useNotificationsStore } from '@/stores/notifications.store';
import { useQueueStore, type QueuedClip, type QueuedEpisode } from '@/stores/queue.store';
import { freshPinia, stubBrowserApis, testRouter } from './mount-with-vuetify';

/**
 * The global player: the one transport for the whole site, and the reason rows
 * have no play button.
 *
 * ⚠️ Two things here are decisions rather than details:
 *
 * - **It renders with nothing playing.** A player that appeared and disappeared
 *   would reflow every list under it and move the queue pill — which is also the
 *   link to `/cola` — out from under the cursor.
 * - **It shows a vote count for the clip it is playing**, which is only possible
 *   because `GET /clips/:id` started returning `up`. For a clip opened by URL
 *   there is no row to have carried it.
 */

vi.mock('@/queries/clips.query', () => ({
  useVoteClip: () => ({ mutateAsync: vi.fn() }),
  useRegisterPlay: () => ({ mutate: vi.fn() }),
  useAddTag: () => ({ mutateAsync: vi.fn() }),
}));

class FakeAudio implements PlaybackAudio {
  src = '';
  currentTime = 0;
  playCalls = 0;
  pauseCalls = 0;
  private readonly listeners = new Map<string, (() => void)[]>();

  play(): Promise<void> {
    this.playCalls += 1;
    return Promise.resolve();
  }
  pause(): void {
    this.pauseCalls += 1;
  }
  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  advanceTo(seconds: number): void {
    this.currentTime = seconds;
    for (const listener of this.listeners.get('timeupdate') ?? []) listener();
  }
}

function episode(id: number, over: Partial<QueuedEpisode> = {}): QueuedEpisode {
  return {
    kind: 'episode',
    id,
    title: `Episodio ${id}`,
    end: 10957,
    src: `https://example.test/episodes/${id}.mp3`,
    cover: 'https://example.test/cover.jpg',
    ...over,
  };
}

function clip(id: number, over: Partial<QueuedClip> = {}): QueuedClip {
  return {
    kind: 'clip',
    id,
    title: `Gazpacho y canis ${id}`,
    start: 100,
    end: 400,
    src: 'https://example.test/episodes/53.mp3',
    episodeId: 53,
    episodeTitle: 'Episodio 53',
    cover: 'https://example.test/cover.jpg',
    up: 13,
    ...over,
  };
}

let audio: FakeAudio;

beforeAll(stubBrowserApis);
beforeEach(() => {
  localStorage.clear();
  audio = new FakeAudio();
  setAudioElementFactory(() => audio);
});

function mountPlayer() {
  return mount(GlobalPlayer, { global: { plugins: [freshPinia(), vuetify, testRouter()] } });
}

describe('with nothing playing', () => {
  it('is still on screen, and says so', () => {
    const wrapper = mountPlayer();

    expect(wrapper.find('.player').exists()).toBe(true);
    expect(wrapper.find('.player__title').text()).toBe('Nada sonando');
    expect(wrapper.text()).toContain('añade cortes a la cola');

    wrapper.unmount();
  });

  it('offers a queue pill that links to /cola even when the queue is empty', () => {
    const wrapper = mountPlayer();

    const pill = wrapper.find('.player__queue');
    expect(pill.attributes('href')).toBe('/cola');
    expect(pill.text()).toContain('0 en cola');

    wrapper.unmount();
  });

  it('disables both transport buttons rather than hiding them', () => {
    const wrapper = mountPlayer();

    expect(wrapper.find('.player__play').attributes('disabled')).toBeDefined();
    expect(wrapper.find('.player__next').attributes('disabled')).toBeDefined();

    wrapper.unmount();
  });
});

describe('with a clip playing', () => {
  async function mountPlaying() {
    const wrapper = mountPlayer();
    useQueueStore().enqueue(clip(137));
    await wrapper.vm.$nextTick();
    resetAudioElementFactory();
    return wrapper;
  }

  it('names the clip and its episode, and links to the permalink', async () => {
    const wrapper = await mountPlaying();

    expect(wrapper.find('.player__title').text()).toBe('Gazpacho y canis 137');
    expect(wrapper.find('.player__title').attributes('href')).toBe('/137');
    expect(wrapper.find('.player__sub').text()).toBe('Nº 137 · Episodio 53');

    wrapper.unmount();
  });

  /**
   * ⚠️ **The count that needed an API change.** A clip queued from a row carries
   * its `up` along; a clip opened by URL has no row behind it, which is why
   * `GET /clips/:id` had to start returning one.
   */
  it('shows the vote count for what it is playing', async () => {
    const wrapper = await mountPlaying();

    const vote = wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label')?.startsWith('Votar') === true);
    expect(vote?.text()).toBe('13');

    wrapper.unmount();
  });

  it('prints elapsed and total time as the clip advances', async () => {
    const wrapper = mountPlayer();
    useQueueStore().enqueue(clip(137));
    await wrapper.vm.$nextTick();

    audio.advanceTo(160);
    await wrapper.vm.$nextTick();

    // 60 s into a 300 s clip.
    expect(wrapper.find('.player__time').text()).toBe('01:00 / 05:00');
    resetAudioElementFactory();
    wrapper.unmount();
  });

  /**
   * ⚠️ **The rule along the top of the player is also the seek control — below
   * 720 px, and there only** (2026-08-22). Above it the waveform both draws the
   * position and seeks, so the fill and the handle are `display: none` and the
   * rule is a rule again; that half is CSS, so it is measured in
   * `test/e2e/specs/05-playback.spec.ts` and cannot be seen from jsdom, which
   * applies no media query. What is asserted here is the control itself.
   *
   * A native `<input type="range">` rather than a `v-slider`: a 3 px rule flush
   * with the top edge of a 78 px band is not a shape Vuetify's slider takes
   * without fighting its own wrapper, and the input brings arrow-key seeking
   * with it.
   */
  it('seeks from the handle on that rule', async () => {
    const wrapper = mountPlayer();
    const playback = usePlaybackStore();
    useQueueStore().enqueue(clip(137));
    await wrapper.vm.$nextTick();

    const seek = wrapper.find<HTMLInputElement>('.player__seek');
    expect(seek.attributes('disabled')).toBeUndefined();

    // 30 % into a 300 s clip.
    seek.element.value = '300';
    await seek.trigger('input');

    expect(playback.elapsed).toBeCloseTo(90, 5);
    expect(wrapper.find('.player__time').text()).toBe('01:30 / 05:00');

    resetAudioElementFactory();
    wrapper.unmount();
  });

  /**
   * ⚠️ **The rule along the top of the player IS the progress bar below 720 px**
   * — it was a static `border-top` until 2026-08-19, and above 720 px it is one
   * again (2026-08-22): the waveform draws the position there. Below it, where
   * the waveform is hidden, this fill is the only place it is drawn.
   */
  it('draws the position along the rule that separates it from the site', async () => {
    const wrapper = mountPlayer();
    useQueueStore().enqueue(clip(137));
    await wrapper.vm.$nextTick();

    const fill = () => wrapper.find('.player__progress-fill').attributes('style') ?? '';
    expect(fill()).toContain('scaleX(0)');

    // 60 s into a 300 s clip.
    audio.advanceTo(160);
    await wrapper.vm.$nextTick();

    expect(fill()).toContain('scaleX(0.2)');
    resetAudioElementFactory();
    wrapper.unmount();
  });

  it('pauses and resumes without restarting the clip', async () => {
    const wrapper = mountPlayer();
    const playback = usePlaybackStore();
    useQueueStore().enqueue(clip(137));
    audio.advanceTo(200);
    await wrapper.vm.$nextTick();

    await wrapper.find('.player__play').trigger('click');
    expect(playback.playing).toBe(false);

    await wrapper.find('.player__play').trigger('click');
    // ⚠️ Where it was, not back at `start`: `resume`, not `play`.
    expect(audio.currentTime).toBe(200);
    expect(playback.playing).toBe(true);

    resetAudioElementFactory();
    wrapper.unmount();
  });

  it('advances with the next button, and disables it on the last clip', async () => {
    const wrapper = mountPlayer();
    const queue = useQueueStore();
    queue.enqueue(clip(1));
    queue.enqueue(clip(2));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.player__next').attributes('disabled')).toBeUndefined();
    await wrapper.find('.player__next').trigger('click');

    expect(usePlaybackStore().currentClipId).toBe(2);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.player__next').attributes('disabled')).toBeDefined();

    resetAudioElementFactory();
    wrapper.unmount();
  });

  it('counts the queue on its pill', async () => {
    const wrapper = mountPlayer();
    const queue = useQueueStore();
    queue.enqueue(clip(1));
    queue.enqueue(clip(2));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.player__queue').text()).toContain('2 en cola');

    resetAudioElementFactory();
    wrapper.unmount();
  });
});

describe('the band it sits on', () => {
  /**
   * ⚠️ The pollitos band is a PHOTOGRAPH with white between the birds, so the
   * ground behind it and the scrim over it are both load-bearing: without them
   * the brown text is unreadable in patches, and only in patches, which is the
   * worst kind of contrast bug to find.
   */
  it('carries the band, a ground and a scrim', () => {
    const wrapper = mountPlayer();

    expect(wrapper.find('.player').attributes('style')).toContain('background-image');
    expect(wrapper.find('.player__scrim').exists()).toBe(true);

    wrapper.unmount();
  });
});

/**
 * A whole episode in the player (2026-08-25).
 *
 * ⚠️ The player is a view over `queue.current`, so "the episode plays in the
 * global player" and "the episode is a queue item" are the same statement. What
 * changes here is only what a player can say about one: an episode has no vote,
 * no download and no `Nº`.
 */
describe('with a whole episode playing', () => {
  it('names it and links to its page, saying what it is', () => {
    const wrapper = mountPlayer();
    useQueueStore().enqueue(episode(93));

    return wrapper.vm.$nextTick().then(() => {
      expect(wrapper.find('.player__title').text()).toBe('Episodio 93');
      // ⚠️ `/episode/<id>-<slug>`, not `/<id>`: an episode's URL has never been
      // the bare id, and the slug is what every link on the site carries.
      expect(wrapper.find('.player__title').attributes('href')).toBe('/episode/93-Episodio-93');
      // ⚠️ Not `Nº 93`: an episode's number is in its own title, and the id
      // that addresses it is not the number anybody knows it by.
      expect(wrapper.find('.player__sub').text()).toBe('Episodio completo');

      wrapper.unmount();
    });
  });

  /**
   * ⚠️ **Absent, not disabled.** Neither action exists for an episode — there
   * is no `POST /episodes/:id/vote` on the wire at all, and the download button
   * cuts a clip out of an episode in the browser, which "the whole three hours"
   * is not.
   *
   * ⚠️ **Marking a moment is the one an episode gains** (2026-08-26), and it is
   * FIRST: below 720 px only the first pill survives, so the DOM order is what
   * decides that a phone keeps `Marcar este momento` for an episode and the vote
   * for a clip.
   */
  it('offers marking and sharing, and neither voting nor downloading', () => {
    const wrapper = mountPlayer();
    useQueueStore().enqueue(episode(93));

    return wrapper.vm.$nextTick().then(() => {
      const labels = wrapper.findAll('.player__pill').map((pill) => pill.attributes('aria-label'));

      expect(labels).toEqual(['Marcar este momento', 'Compartir este episodio']);

      wrapper.unmount();
    });
  });

  /**
   * ⚠️ **Mis momentos** (2026-08-26). The player carries the button because it
   * is what keeps sounding when the visitor walks off the episode's own page —
   * that is the whole reason an episode goes through the queue at all.
   */
  describe('marking a moment', () => {
    const MOMENTS_KEY = 'gravindex.moments';

    it('stores the second before the button was pressed, against this episode', () => {
      const wrapper = mountPlayer();
      useQueueStore().enqueue(episode(93));

      return wrapper.vm.$nextTick().then(async () => {
        audio.advanceTo(1000);
        await wrapper.vm.$nextTick();

        await wrapper.find('[data-test="mark-moment"]').trigger('click');

        // 1000 minus the four seconds nobody presses in time.
        expect(JSON.parse(localStorage.getItem(MOMENTS_KEY) ?? '{}')).toMatchObject({
          moments: [{ episodeId: 93, at: 996 }],
        });

        wrapper.unmount();
      });
    });

    it('says what it marked, and says it is already marked the second time', () => {
      const wrapper = mountPlayer();
      useQueueStore().enqueue(episode(93));
      const notifications = useNotificationsStore();

      return wrapper.vm.$nextTick().then(async () => {
        audio.advanceTo(1000);
        await wrapper.vm.$nextTick();

        await wrapper.find('[data-test="mark-moment"]').trigger('click');
        expect(notifications.items.at(-1)?.title).toBe('Momento marcado en 00:16:36');

        await wrapper.find('[data-test="mark-moment"]').trigger('click');
        // ⚠️ Not an error: pressing twice at the same laugh is reasonable, and
        // the answer is "ya lo tienes" — the same shape as the repeated vote.
        expect(notifications.items.at(-1)?.text).toContain('ya estaba marcado');
        expect(notifications.items.at(-1)?.level).toBe('info');

        wrapper.unmount();
      });
    });

    it('counts the marks of this episode in its spoken name', () => {
      localStorage.setItem(
        MOMENTS_KEY,
        JSON.stringify({ moments: [{ episodeId: 93, at: 10, markedAt: 1 }] }),
      );
      const wrapper = mountPlayer();
      useQueueStore().enqueue(episode(93));

      return wrapper.vm.$nextTick().then(() => {
        expect(wrapper.find('[data-test="mark-moment"]').attributes('aria-label')).toBe(
          'Marcar este momento (ya tienes 1 en este episodio)',
        );

        wrapper.unmount();
      });
    });

    /** ⚠️ A clip already IS the moment, and it has a permalink to say so. */
    it('is not offered while a clip is playing', () => {
      const wrapper = mountPlayer();
      useQueueStore().enqueue(clip(178));

      return wrapper.vm.$nextTick().then(() => {
        expect(wrapper.find('[data-test="mark-moment"]').exists()).toBe(false);

        wrapper.unmount();
      });
    });
  });

  it('prints its length and advances against it', () => {
    const wrapper = mountPlayer();
    useQueueStore().enqueue(episode(93));

    return wrapper.vm.$nextTick().then(async () => {
      expect(wrapper.find('.player__time').text()).toBe('00:00 / 03:02:37');

      audio.advanceTo(90);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.player__time').text()).toBe('01:30 / 03:02:37');

      wrapper.unmount();
    });
  });

  /** ⚠️ The queue holds both shapes at once, and the player draws whichever is
   *  current — including across a `next()`. */
  it('follows the queue from an episode to a clip', () => {
    const wrapper = mountPlayer();
    const queue = useQueueStore();
    queue.enqueue(episode(93));
    queue.enqueue(clip(178, { title: 'La mulata' }));

    return wrapper.vm.$nextTick().then(async () => {
      expect(wrapper.find('.player__sub').text()).toBe('Episodio completo');

      queue.next();
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.player__title').text()).toBe('La mulata');
      expect(wrapper.find('.player__sub').text()).toContain('Nº 178');

      wrapper.unmount();
    });
  });
});
