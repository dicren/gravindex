/**
 * The clip editor's own audio element, and the seam that lets it be tested.
 *
 * ⚠️ **The editor deliberately does NOT use `playback.store`,** and the reason is
 * that the two are doing different jobs. The store plays *a clip*: it is keyed by
 * clip id, it clamps every seek into `[start, end]`, and it stops playback the
 * moment `currentTime` reaches `end`. The editor is *making* that clip — its
 * `start` and `end` move under the cursor, it must scrub over the whole episode
 * (a minute back, five seconds before the end), it needs a playback rate, and
 * the cut it is editing has no id until it is published. Feeding a moving `end`
 * into a store whose contract is "stop there" would halt playback every time the
 * user dragged the right-hand handle.
 *
 * So this screen owns one element for as long as it is mounted, pauses it on the
 * way out, and asks `playback.store` to stop whatever it was playing on the way
 * in — which is what keeps "one thing plays at a time" true across the two.
 *
 * ⚠️ Structural interface rather than `HTMLAudioElement`, for the same reason
 * the store uses one: jsdom does not implement `HTMLMediaElement.play()` and
 * reports no duration, so a real element could never be asserted against.
 */

export type EditorAudioEvent = 'canplay' | 'timeupdate' | 'waiting' | 'ended';

/** The slice of `HTMLAudioElement` the editor drives. `new Audio(src)` satisfies it. */
export interface EditorAudio {
  currentTime: number;
  /** Seconds. ⚠️ `NaN` until the browser has metadata — see `formatHhmmss`. */
  readonly duration: number;
  playbackRate: number;
  play(): Promise<void> | void;
  pause(): void;
  addEventListener(type: EditorAudioEvent, listener: () => void): void;
  removeEventListener(type: EditorAudioEvent, listener: () => void): void;
}

/**
 * ⚠️ The episode's mp3 is **remote and never proxied** (root `CLAUDE.md`): the
 * browser streams it and seeks inside it, which is why every seek here is
 * debounced rather than fired per pointer move.
 */
export function createEditorAudio(src: string): EditorAudio {
  return new Audio(src);
}
