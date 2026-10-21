import { DomainError } from '#/domain/errors';
import type { NotificationInput } from '@/stores/notifications.store';

/**
 * Turn a failed write or read into something the toast queue can show, as
 * plain text.
 *
 * ⚠️ **Branch on `code`, never on a status.** That is the contract in
 * `core/domain/errors`: views do not know the transport is HTTP. The three
 * cases below are the three genuinely different things that can go wrong, and
 * the first one is the reason this file exists at all.
 *
 * - `REQUEST_REJECTED` — the server understood and refused, and `message` is
 *   **its own explanation**, already fit to read. Showing it is the useful half
 *   of the notice; flattening it into "no se ha podido conectar" would be a lie
 *   about a request that arrived perfectly.
 * - `NOT_FOUND` — a legitimate answer, not a failure. A view that *navigates*
 *   on a 404 uses `goToErrorPage` instead; this is for the ones that stay put.
 * - anything else — transport, or a shape we did not expect. There is nothing
 *   truthful to say beyond "it did not go through".
 *
 * ⚠️ The two Spanish strings below are **deliberately new copy**: `ex.toString()`
 * would show `Error: Network Error` in English inside a Spanish UI, so the
 * message is written out instead.
 */
export function domainErrorNotice(error: unknown): NotificationInput {
  if (error instanceof DomainError) {
    switch (error.code) {
      case 'REQUEST_REJECTED':
      case 'VALIDATION_ERROR':
        return { level: 'error', text: error.message };
      case 'NOT_FOUND':
        return { level: 'error', text: 'No hemos encontrado eso.' };
      default:
        break;
    }
  }
  return { level: 'error', text: 'No se ha podido conectar con el servidor.' };
}
