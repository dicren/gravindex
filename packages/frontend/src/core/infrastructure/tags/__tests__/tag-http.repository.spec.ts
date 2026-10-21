import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NetworkError,
  NotFoundError,
  RequestRejectedError,
  UnexpectedResponseError,
} from '#/domain/errors';
import { TagHttpRepository } from '../tag-http.repository';

/**
 * ⚠️ The template every infrastructure spec copies, and the one place the
 * generated client is actually exercised.
 *
 * It stubs the global `fetch` — no network, no server — and asserts the URL the
 * adapter ends up requesting. That assertion is the proof behind the claim that
 * no endpoint path is written by hand: `/api/tags` appears nowhere in this
 * package's source, only in `packages/backend/openapi.json` and the code
 * generated from it. If the backend renames the route, regenerating changes
 * this expectation, and that is the point.
 */
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function stubFetch(response: Response) {
  const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(response);
  globalThis.fetch = fetchStub;
  return fetchStub;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('TagHttpRepository', () => {
  // ⚠️ `{ tag, count }`, not a flat `string[]`: the library's tag filter prints
  // every tag with how many clips carry it, and the browser cannot derive that
  // from one page of clips.
  it('requests the generated GET /api/tags operation and returns the tags with counts', async () => {
    const fetchStub = stubFetch(
      jsonResponse([
        { tag: 'Absurdo', count: 3 },
        { tag: 'Anécdotas', count: 18 },
        { tag: 'Zombies', count: 1 },
      ]),
    );

    await expect(new TagHttpRepository().listAll()).resolves.toEqual([
      { tag: 'Absurdo', count: 3 },
      { tag: 'Anécdotas', count: 18 },
      { tag: 'Zombies', count: 1 },
    ]);

    const request = fetchStub.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    expect((request as Request).url).toContain('/api/tags');
    expect((request as Request).method).toBe('GET');
  });

  // The narrow schema earning its place: a backend rolled back to the old shape
  // has to fail here, loudly, rather than render 102 empty rows.
  it('rejects a flat string array', async () => {
    stubFetch(jsonResponse(['Absurdo', 'Anécdotas']));

    await expect(new TagHttpRepository().listAll()).rejects.toThrow();
  });

  it('turns a 404 into a NotFoundError rather than a generic failure', async () => {
    stubFetch(jsonResponse({ message: 'nope' }, 404));

    await expect(new TagHttpRepository().listAll()).rejects.toBeInstanceOf(NotFoundError);
  });

  it('⚠️ turns a refusal into a RequestRejectedError carrying what the server said', async () => {
    // A read path, to show the taxonomy is not a write-only concern: an
    // `order` outside the backend's whitelist earns exactly this.
    stubFetch(jsonResponse({ statusCode: 400, message: 'order must be one of …' }, 400));

    const failure = await new TagHttpRepository().listAll().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RequestRejectedError);
    expect(failure).not.toBeInstanceOf(NetworkError);
    expect((failure as RequestRejectedError).message).toBe('order must be one of …');
  });

  it('turns a payload that breaks the contract into an UnexpectedResponseError', async () => {
    // A raw ZodError must never escape infrastructure.
    stubFetch(jsonResponse({ tags: ['Zombies'] }));

    await expect(new TagHttpRepository().listAll()).rejects.toBeInstanceOf(UnexpectedResponseError);
  });
});
