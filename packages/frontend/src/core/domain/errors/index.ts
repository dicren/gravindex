/**
 * The only errors the rest of the app is allowed to understand.
 *
 * ⚠️ An `HTTPError`, a `ZodError` or a bare `TypeError` from `fetch` must never
 * escape `core/infrastructure/` — `translate-http-error.ts` converts them here
 * first. The UI branches on `DomainError.code`, never on an HTTP status, which
 * is what keeps views from knowing that the transport is HTTP at all.
 */
export type DomainErrorCode =
  | 'NETWORK_ERROR'
  | 'NOT_FOUND'
  | 'REQUEST_ABORTED'
  | 'REQUEST_REJECTED'
  | 'UNEXPECTED_RESPONSE'
  | 'VALIDATION_ERROR';

export abstract class DomainError extends Error {
  abstract readonly code: DomainErrorCode;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The request never produced an answer we could use: offline, DNS, timeout, 5xx. */
export class NetworkError extends DomainError {
  readonly code = 'NETWORK_ERROR';
}

/** The resource does not exist. Distinct from `NETWORK_ERROR` because it is a
 *  legitimate answer, not a failure — a clip id from an old shared link, say. */
export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
}

/**
 * **Nobody wants the answer any more.** The caller passed an `AbortSignal` and
 * then aborted it: a search superseded by the next keystroke, a list whose
 * screen was left. The request did not fail — it was withdrawn.
 *
 * ⚠️ **This must never become a notice.** It is not a network failure and
 * telling a visitor "no se ha podido conectar" because they typed another
 * letter would be both false and constant. Two things keep that true, and both
 * are deliberate:
 *
 * - **Only reads are cancellable.** Votes, tags and clip creation take no
 *   signal at all (see `ClipRepository`), so no write path — the only place
 *   `domainErrorNotice` is called from — can ever produce one.
 * - **Reads surface errors through their Pinia Colada entry**, and
 *   `vue/queries/abortable.ts` rethrows the signal's own reason so Colada
 *   recognises the rejection as its own cancellation and leaves the entry's
 *   state untouched. So this error is *raised* here, and *swallowed* at the
 *   delivery boundary, never in between.
 *
 * It still exists, rather than being folded into `NETWORK_ERROR`, because a
 * withdrawn request and an unreachable server are not the same event, and the
 * layer that can tell them apart is this one. Anything that starts cancelling a
 * write has to answer this comment first.
 */
export class RequestAbortedError extends DomainError {
  readonly code = 'REQUEST_ABORTED';
}

/**
 * The server understood the request and **refused** it: any 4xx that is not a
 * 404. `message` is the server's own explanation, ready to show.
 *
 * ⚠️ This exists because flattening it into `NETWORK_ERROR` was a real
 * usability bug. The backend runs a global `ValidationPipe`, so **400 is the
 * ordinary answer to a user mistake** — a clip title over 255 characters, an
 * `end` at or before `start`, an `order` outside the whitelist — and telling
 * that user "the server could not be reached" is simply false. It also hid the
 * one piece of information they needed.
 *
 * Two things it is deliberately NOT:
 *
 * - **Not a 404.** That is `NotFoundError`: the resource is gone, which is an
 *   answer rather than a refusal, and the app routes to a different page for it.
 * - **Not a 5xx.** Those stay `NetworkError`: the server did not decide
 *   anything, it broke, and there is nothing truthful to show the user beyond
 *   "try again".
 *
 * ⚠️ It carries no HTTP status, on purpose. Views branch on `code`; the moment
 * one of them reads a number here, the transport has leaked out of
 * `infrastructure` (see the file header).
 */
export class RequestRejectedError extends DomainError {
  readonly code = 'REQUEST_REJECTED';
}

/** The server answered, but not with the shape the contract promised. Thrown
 *  only from infrastructure, when a DTO schema rejects the payload. */
export class UnexpectedResponseError extends DomainError {
  readonly code = 'UNEXPECTED_RESPONSE';
}

/**
 * User input rejected by our own rules, before the network was involved.
 *
 * Raised from `core/application` — the use cases restate the backend's own DTO
 * rules so the editor can answer without a round trip.
 *
 * ⚠️ With **one** deliberate exception in `infrastructure`:
 * `ClipHttpRepository.vote` refuses to send a request with no anonymous voter
 * token. That check lives there because the token is injected there by design,
 * so that no use case and no view ever handles one — and the alternative,
 * sending an empty header, earns a 400 that blames the server for a client bug.
 * Do not "fix" that by moving the guard; this comment is the fix.
 */
export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_ERROR';
}
