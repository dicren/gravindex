import { DomainError } from '#/domain/errors';

/**
 * The server refused the admin credential: no token, an expired one (they last
 * 12 h), or one whose `user` row is gone.
 *
 * ⚠️ **It exists so that no view ever reads an HTTP status.** Every admin route
 * answers 401 for exactly this, and the app has to react to it differently from
 * any other refusal — a 400 from the validation pipe means "fix the form and
 * try again", a 401 means "you are not logged in any more". Both arrive as a
 * 4xx, so without a distinct type the only way to tell them apart in `vue/`
 * would be to look at the number, which is precisely what
 * `core/domain/errors` exists to prevent.
 *
 * ⚠️ Its `code` is `REQUEST_REJECTED` on purpose, and that is not a compromise:
 * the server *did* understand and refuse. Anything that only knows about codes
 * — `domainErrorNotice`, say — keeps treating it as a refusal and shows the
 * message. The subclass is the extra bit of information, available to whoever
 * cares, invisible to whoever does not.
 *
 * ⚠️ It is **never** thrown for a failed login. Wrong credentials are a
 * `RequestRejectedError` like any other refusal: the session did not expire,
 * it never started, and the two must not share a code path or the login screen
 * would try to send itself back to the login screen.
 */
export class AdminSessionExpiredError extends DomainError {
  readonly code = 'REQUEST_REJECTED';

  constructor(message = 'The admin session is no longer valid.') {
    super(message);
  }
}
