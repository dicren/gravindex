import { describe, expect, it } from 'vitest';
import {
  NetworkError,
  NotFoundError,
  RequestAbortedError,
  RequestRejectedError,
  UnexpectedResponseError,
  ValidationError,
} from '#/domain/errors';
import { assertResponseOk, serverMessageOf, translateHttpError } from '../translate-http-error';
import { ZodError } from 'zod';

/**
 * ⚠️ The regression this file exists for: **a refusal is not a transport
 * failure.** Every non-2xx that was not a 404 used to become
 * `NetworkError('The server answered 400.')`, so an over-long clip title told
 * the user the server was unreachable — and threw away the one sentence that
 * said what was actually wrong. With the backend's global `ValidationPipe` on,
 * 400 is the *ordinary* answer to a user mistake, which is what makes the lie
 * expensive rather than merely untidy.
 */
function responseWith(status: number) {
  return new Response(null, { status });
}

describe('assertResponseOk', () => {
  it('passes a 2xx through', () => {
    expect(() => assertResponseOk(responseWith(200))).not.toThrow();
    expect(() => assertResponseOk(responseWith(201))).not.toThrow();
    expect(() => assertResponseOk(responseWith(204))).not.toThrow();
  });

  it('reports a request that never completed as a network failure', () => {
    expect(() => assertResponseOk(undefined)).toThrow(NetworkError);
  });

  it('keeps 404 as its own answer rather than a failure', () => {
    expect(() => assertResponseOk(responseWith(404))).toThrow(NotFoundError);
  });

  it('⚠️ surfaces a 400 as a REFUSAL carrying the server message, not as a network failure', () => {
    let thrown: unknown;
    try {
      assertResponseOk(responseWith(400), {
        statusCode: 400,
        message: ['title must be shorter than or equal to 255 characters'],
        error: 'Bad Request',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RequestRejectedError);
    expect(thrown).not.toBeInstanceOf(NetworkError);
    expect((thrown as RequestRejectedError).code).toBe('REQUEST_REJECTED');
    expect((thrown as RequestRejectedError).message).toBe(
      'title must be shorter than or equal to 255 characters',
    );
    // A generic status line must never be the message; spelled out so it cannot come back.
    expect((thrown as RequestRejectedError).message).not.toContain('The server answered 400');
  });

  it('joins every broken rule the ValidationPipe reported', () => {
    expect(() =>
      assertResponseOk(responseWith(400), {
        statusCode: 400,
        message: ['end must be greater than start', 'title should not be empty'],
      }),
    ).toThrow('end must be greater than start. title should not be empty');
  });

  it('treats any other 4xx as a refusal too, message included', () => {
    expect(() => assertResponseOk(responseWith(409), { message: 'Tag repeated' })).toThrow(
      new RequestRejectedError('Tag repeated'),
    );
    expect(() => assertResponseOk(responseWith(401), { message: 'Unauthorized' })).toThrow(
      RequestRejectedError,
    );
  });

  it('falls back to plain words when the refusal came with no explanation', () => {
    let thrown: unknown;
    try {
      assertResponseOk(responseWith(400));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RequestRejectedError);
    // ⚠️ No status code in text a user can read: "400" is not actionable.
    expect((thrown as RequestRejectedError).message).not.toMatch(/\d{3}/);
  });

  it('⚠️ leaves a 5xx as a network failure — the server decided nothing, it broke', () => {
    expect(() => assertResponseOk(responseWith(500), { message: 'boom' })).toThrow(NetworkError);
    expect(() => assertResponseOk(responseWith(503))).toThrow(NetworkError);
  });
});

describe('serverMessageOf', () => {
  it('reads the two shapes NestJS actually sends', () => {
    expect(serverMessageOf({ statusCode: 409, message: 'Tag repeated' })).toBe('Tag repeated');
    expect(serverMessageOf({ message: ['a', 'b'] })).toBe('a. b');
  });

  it('accepts a bare text body', () => {
    expect(serverMessageOf('Payload Too Large')).toBe('Payload Too Large');
  });

  it('answers undefined rather than stringifying something it does not understand', () => {
    expect(serverMessageOf(undefined)).toBeUndefined();
    expect(serverMessageOf(null)).toBeUndefined();
    expect(serverMessageOf({ detail: 'nope' })).toBeUndefined();
    expect(serverMessageOf({ message: { nested: true } })).toBeUndefined();
    expect(serverMessageOf({ message: '   ' })).toBeUndefined();
    expect(serverMessageOf({ message: [] })).toBeUndefined();
  });
});

describe('translateHttpError', () => {
  it('leaves an already-translated domain error alone', () => {
    const rejected = new RequestRejectedError('title should not be empty');
    expect(translateHttpError(rejected)).toBe(rejected);
    const invalid = new ValidationError('nope');
    expect(translateHttpError(invalid)).toBe(invalid);
  });

  it('turns a schema failure into an UnexpectedResponseError', () => {
    expect(translateHttpError(new ZodError([]))).toBeInstanceOf(UnexpectedResponseError);
  });

  it('turns anything else into a NetworkError', () => {
    expect(translateHttpError(new TypeError('Failed to fetch'))).toBeInstanceOf(NetworkError);
  });
});

/**
 * ⚠️ **A cancelled request is not a failed one.** Only reads are cancellable,
 * and the reason they must not fall into `NETWORK_ERROR` is that a superseded
 * search is the most ordinary event in the app: every keystroke in the library's
 * search box produces one. Reporting those as "the server could not be reached"
 * would be both false and constant.
 */
describe('translateHttpError — a withdrawn request', () => {
  function abortedSignal(reason?: unknown): AbortSignal {
    const controller = new AbortController();
    controller.abort(reason);
    return controller.signal;
  }

  it('reports an aborted signal as REQUEST_ABORTED', () => {
    const signal = abortedSignal();
    const translated = translateHttpError(signal.reason, signal);

    expect(translated).toBeInstanceOf(RequestAbortedError);
    expect(translated).not.toBeInstanceOf(NetworkError);
    expect(translated.code).toBe('REQUEST_ABORTED');
  });

  it('⚠️ trusts the signal, not the error’s name — `abort(reason)` takes any value', () => {
    // Pinia Colada's `cancelQueries(filters, reason)` passes its own reason, so
    // the rejection is whatever the caller chose. Matching on `AbortError` alone
    // would silently classify those as network failures.
    const signal = abortedSignal(new Error('a reason of our own choosing'));

    expect(translateHttpError(signal.reason, signal)).toBeInstanceOf(RequestAbortedError);
  });

  it('recognises a bare AbortError even with no signal to ask', () => {
    const aborted = new DOMException('The operation was aborted.', 'AbortError');

    expect(translateHttpError(aborted)).toBeInstanceOf(RequestAbortedError);
  });

  it('⚠️ wins over an already-translated DomainError: nobody is waiting for it', () => {
    // A late 404 on a request the visitor withdrew is not news about the server.
    const signal = abortedSignal();

    expect(translateHttpError(new NotFoundError('gone'), signal)).toBeInstanceOf(
      RequestAbortedError,
    );
  });

  it('leaves a real failure alone while the signal is intact', () => {
    const signal = new AbortController().signal;

    expect(translateHttpError(new TypeError('Failed to fetch'), signal)).toBeInstanceOf(
      NetworkError,
    );
    // ⚠️ `ky`'s timeout aborts its OWN controller, never the caller's, so a
    // request that ran out of time stays a network failure — which it is.
    const timeout = new Error('Request timed out');
    timeout.name = 'TimeoutError';
    expect(translateHttpError(timeout, signal)).toBeInstanceOf(NetworkError);
  });
});
