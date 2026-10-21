/**
 * The join between Pinia Colada's cancellation and `core/`'s.
 *
 * Colada hands every query function an `AbortSignal` and aborts it when the
 * call becomes outdated — a key that changed because the visitor typed another
 * letter, or an entry nothing is watching any more. Handing that signal to the
 * use case is the whole of the fix: it travels inward as a plain web standard,
 * reaches the generated client, and ends up on the `Request` that `fetch`
 * actually sends. Before this existed the signal was offered and dropped, so
 * an abandoned search ran to completion.
 *
 * ## Why the rejection is rewritten
 *
 * ⚠️ **`throw signal.reason` is load-bearing, not tidying.** Colada decides
 * whether a rejected query becomes the entry's error state by comparing the
 * thrown value with the signal's own `reason`:
 *
 * ```js
 * .catch((error) => {
 *   if (pendingCall === entry.pending && (error !== signal.reason || !signal.aborted))
 *     setEntryState(entry, { status: 'error', error })
 * })
 * ```
 *
 * A `RequestAbortedError` is not that value, so without this the abandoned
 * entry is *stored as failed*. Nothing shows it while it is off screen — but
 * come back to that exact filter inside the cache's lifetime and the view finds
 * an error waiting for it, produced by a request the visitor themselves
 * cancelled. Rethrowing the reason is how the cancellation stays invisible,
 * which is the only correct outcome: nobody is waiting for that answer.
 *
 * The `RequestAbortedError` still earns its place — it is what any non-Colada
 * caller of a use case would see, and it is what keeps an abort from being
 * mistaken for a network failure inside `core/` (see `domain/errors`).
 */
import { RequestAbortedError } from '#/domain/errors';

/**
 * Wrap a use-case call so Colada's signal reaches it and its cancellation stays
 * silent.
 *
 * ```ts
 * query: abortable((signal) => listClipsUseCase.execute(query, signal)),
 * ```
 *
 * ⚠️ Reads only. A write is not cancellable anywhere in this app — the ports
 * do not even take a signal — so there is nothing here for `useMutation`.
 */
export function abortable<TData>(
  run: (signal: AbortSignal) => Promise<TData>,
): (context: { signal: AbortSignal }) => Promise<TData> {
  return async ({ signal }) => {
    try {
      return await run(signal);
    } catch (error) {
      // ⚠️ Guarded by BOTH: a `RequestAbortedError` can only come from this
      // signal (the repository raises it from `signal.aborted`), and the signal
      // being aborted is what makes `reason` the value Colada is looking for.
      if (signal.aborted && error instanceof RequestAbortedError) {
        throw signal.reason;
      }
      throw error;
    }
  };
}
