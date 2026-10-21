import { ZodError } from 'zod';
import {
  DomainError,
  NetworkError,
  NotFoundError,
  RequestAbortedError,
  RequestRejectedError,
  UnexpectedResponseError,
} from '#/domain/errors';

/**
 * Fallback text for a refusal the server did not bother to explain.
 *
 * ⚠️ Deliberately not "the server answered 4xx". This string can reach a user,
 * and a status code is not something a listener of a podcast index can act on.
 */
const UNEXPLAINED_REFUSAL = 'The server refused the request.';

/**
 * The server's own explanation, dug out of the error payload the generated
 * client already parsed.
 *
 * ⚠️ NestJS shapes: a plain `HttpException` sends
 * `{ statusCode, message: string, error }` while the global `ValidationPipe`
 * sends `message` as an **array**, one entry per broken rule. Both are handled,
 * and a body of some other shape yields `undefined` rather than a stringified
 * object.
 */
export function serverMessageOf(body: unknown): string | undefined {
  if (typeof body === 'string') {
    return body.trim() || undefined;
  }
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }

  const { message } = body as { message?: unknown };
  if (typeof message === 'string') {
    return message.trim() || undefined;
  }
  if (Array.isArray(message)) {
    // `class-validator` messages are sentence fragments without punctuation
    // ("title must be shorter than or equal to 255 characters"), so joining
    // with a full stop is what makes several of them readable as one notice.
    const reasons = message
      .filter((reason): reason is string => typeof reason === 'string')
      .map((reason) => reason.trim())
      .filter((reason) => reason !== '');
    return reasons.length > 0 ? reasons.join('. ') : undefined;
  }
  return undefined;
}

/**
 * Throws unless the call came back with a 2xx.
 *
 * ⚠️ `response` really is optional. The generated client returns it undefined
 * when the request never completed — offline, DNS, timeout, a malformed URL —
 * so "no response" and "a bad response" are different failures and the first
 * one is easy to forget until it shows up as `Cannot read properties of
 * undefined` in production.
 *
 * ⚠️ 404 gets its own error on purpose. It is a legitimate answer, not a
 * failure: a handful of clip ids were removed by hand long ago and their
 * permalinks are still shared, so the app must be able to say "this clip is
 * gone" rather than "something went wrong".
 *
 * ⚠️ **Every other 4xx is a REFUSAL, not a transport failure.** The backend
 * validates every request now, so a 400 is the normal answer to a user mistake
 * and the user must be told what it was. `errorBody` is what carries that
 * message — pass the generated client's own `error` field:
 *
 * ```ts
 * const { data, error: failure, response } = await clipsControllerCreate(...);
 * assertResponseOk(response, failure);
 * ```
 *
 * It has to be passed in, and cannot be read here: on a non-2xx the generated
 * client has already drained the body to parse it, so `response.json()` at this
 * point throws "body stream already read".
 *
 * A 5xx stays a `NetworkError` — the server did not decide anything, it broke.
 */
export function assertResponseOk(response: Response | undefined, errorBody?: unknown): void {
  if (response === undefined) {
    throw new NetworkError('The request never reached the server.');
  }
  if (response.status === 404) {
    throw new NotFoundError(`Not found: ${response.url}`);
  }
  if (response.status >= 400 && response.status < 500) {
    throw new RequestRejectedError(serverMessageOf(errorBody) ?? UNEXPLAINED_REFUSAL);
  }
  if (!response.ok) {
    throw new NetworkError(`The server answered ${response.status}.`);
  }
}

/**
 * An aborted `fetch` rejects with the signal's `reason`, and that reason is
 * whatever the caller passed to `abort()` — a `DOMException` named `AbortError`
 * when it passed nothing, an arbitrary value when it did.
 *
 * ⚠️ So the NAME is a hint, not the test. `translateHttpError` asks the signal
 * itself first, and only falls back to this for a signal it was not given (an
 * abort from somewhere else in the stack).
 */
function looksAborted(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

/**
 * Anything thrown while talking to the API, as a `DomainError`.
 *
 * ⚠️ No raw `ZodError`, no `TypeError` from `fetch`, no transport error may
 * leave `core/infrastructure/`. Every repository method ends in
 * `catch (error) { throw translateHttpError(error) }` — and a **read**, which
 * carries an `AbortSignal`, passes it too:
 * `catch (error) { throw translateHttpError(error, signal) }`.
 *
 * ⚠️ **A withdrawn request is checked FIRST, before `instanceof DomainError`.**
 * Once the signal is aborted nobody is waiting for the answer, so whatever came
 * out of the call — a rejection, a late 404, a shape that failed to parse — is
 * not a fact about the server worth reporting. Reporting it anyway is how an
 * abandoned search ends up painting an error over the results of the one the
 * visitor actually typed.
 *
 * ⚠️ `ky`'s own timeout is NOT this. It aborts an internal controller and
 * rejects with its `TimeoutError`, leaving the caller's signal untouched — so a
 * request that ran out of time stays a `NetworkError`, which is what it is.
 */
export function translateHttpError(error: unknown, signal?: AbortSignal): DomainError {
  if (signal?.aborted === true || looksAborted(error)) {
    return new RequestAbortedError('The request was cancelled before it answered.', {
      cause: error,
    });
  }
  // Already translated — typically from `assertResponseOk` inside the same
  // `try`. Re-wrapping it would erase the status we just worked out.
  if (error instanceof DomainError) {
    return error;
  }
  if (error instanceof ZodError) {
    return new UnexpectedResponseError('The server answered in an unexpected shape.', {
      cause: error,
    });
  }
  return new NetworkError('Could not reach the server.', { cause: error });
}
