import { describe, expect, it, vi } from 'vitest';
import type { ClipRepository } from '#/domain/clips/clip.repository';
import { NetworkError } from '#/domain/errors';
import { ListClipsUseCase } from '../list-clips.use-case';
import { createClipRepositoryStub } from './clip-repository.stub';

describe('ListClipsUseCase', () => {
  it('hands the filter to the repository untouched, search and tags together', async () => {
    // ⚠️ A search NARROWS which tag rows the tag filter can see. That interaction
    // lives in the backend and is part of its contract. This layer must not try
    // to compensate for it by, say, dropping one of the two.
    const list = vi.fn<ClipRepository['list']>().mockResolvedValue({ results: [], total: 0 });
    const useCase = new ListClipsUseCase(createClipRepositoryStub({ list }));
    const query = {
      page: 2,
      limit: 12,
      order: 'episode.date',
      search: 'canción',
      tags: ['Absurdo'],
    } as const;

    await useCase.execute(query);

    expect(list).toHaveBeenCalledWith(query, undefined);
  });

  it('defaults to the empty filter, letting the API pick page, limit and order', async () => {
    const list = vi.fn<ClipRepository['list']>().mockResolvedValue({ results: [], total: 0 });
    const useCase = new ListClipsUseCase(createClipRepositoryStub({ list }));

    await useCase.execute();

    expect(list).toHaveBeenCalledWith({}, undefined);
  });

  it('⚠️ carries the caller’s AbortSignal down to the repository', async () => {
    // The whole point of the parameter: `vue/queries/abortable.ts` gets the
    // signal from Pinia Colada, and this layer is the only thing between it and
    // the adapter that can act on it. A use case that accepted the signal and
    // dropped it would compile, pass every other test here, and leave every
    // superseded search running — which is exactly the bug this parameter fixes.
    const list = vi.fn<ClipRepository['list']>().mockResolvedValue({ results: [], total: 0 });
    const useCase = new ListClipsUseCase(createClipRepositoryStub({ list }));
    const controller = new AbortController();

    await useCase.execute({ search: 'zombi' }, controller.signal);

    expect(list).toHaveBeenCalledWith({ search: 'zombi' }, controller.signal);
  });

  it('lets a repository error through as a DomainError', async () => {
    const list = vi
      .fn<ClipRepository['list']>()
      .mockRejectedValue(new NetworkError('Could not reach the server.'));
    const useCase = new ListClipsUseCase(createClipRepositoryStub({ list }));

    await expect(useCase.execute({})).rejects.toBeInstanceOf(NetworkError);
  });
});
