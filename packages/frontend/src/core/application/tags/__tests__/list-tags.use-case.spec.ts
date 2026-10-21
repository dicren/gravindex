import { describe, expect, it, vi } from 'vitest';
import type { TagRepository } from '#/domain/tags/tag.repository';
import { NetworkError } from '#/domain/errors';
import { ListTagsUseCase } from '../list-tags.use-case';

/**
 * ⚠️ The template every use-case spec copies: a stub typed by the PORT, with
 * one `vi.fn<Port['method']>()` per member and an `overrides` spread.
 *
 * Typing the stub as `TagRepository` is what makes it useful — add a method to
 * the port and every spec stops compiling until it is accounted for, which is
 * exactly the reminder a hand-rolled `{ listAll: vi.fn() }` never gives.
 *
 * No network, no Vue, no Pinia, no jsdom needed: that is what the hexagonal
 * split buys, and the reason use cases must stay plain async functions.
 */
function createTagRepositoryStub(overrides: Partial<TagRepository> = {}): TagRepository {
  return {
    listAll: vi.fn<TagRepository['listAll']>(),
    ...overrides,
  };
}

describe('ListTagsUseCase', () => {
  it('returns the tags the repository yields, untouched', async () => {
    // Accents and case are deliberate: tags are matched EXACTLY by the API, so
    // a use case that normalized them would silently break the library filter.
    const listAll = vi.fn<TagRepository['listAll']>().mockResolvedValue([
      { tag: 'Anécdotas', count: 18 },
      { tag: 'after nigth', count: 1 },
    ]);
    const useCase = new ListTagsUseCase(createTagRepositoryStub({ listAll }));

    // ⚠️ `{ tag, count }`, and the ORDER is untouched too:
    // the endpoint answers in code-point order and the filter re-sorts by use.
    await expect(useCase.execute()).resolves.toEqual([
      { tag: 'Anécdotas', count: 18 },
      { tag: 'after nigth', count: 1 },
    ]);
    expect(listAll).toHaveBeenCalledTimes(1);
  });

  it('lets the repository error through as a DomainError', async () => {
    const listAll = vi
      .fn<TagRepository['listAll']>()
      .mockRejectedValue(new NetworkError('Could not reach the server.'));
    const useCase = new ListTagsUseCase(createTagRepositoryStub({ listAll }));

    await expect(useCase.execute()).rejects.toBeInstanceOf(NetworkError);
  });
});
