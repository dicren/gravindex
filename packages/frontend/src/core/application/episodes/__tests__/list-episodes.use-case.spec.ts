import { describe, expect, it, vi } from 'vitest';
import type { EpisodeRepository } from '#/domain/episodes/episode.repository';
import { NetworkError } from '#/domain/errors';
import { ListEpisodesUseCase } from '../list-episodes.use-case';

function createEpisodeRepositoryStub(
  overrides: Partial<EpisodeRepository> = {},
): EpisodeRepository {
  return {
    list: vi.fn<EpisodeRepository['list']>(),
    findById: vi.fn<EpisodeRepository['findById']>(),
    getWaveform: vi.fn<EpisodeRepository['getWaveform']>(),
    ...overrides,
  };
}

describe('ListEpisodesUseCase', () => {
  it('passes page, limit and search through', async () => {
    const list = vi.fn<EpisodeRepository['list']>().mockResolvedValue({ results: [], total: 0 });
    const useCase = new ListEpisodesUseCase(createEpisodeRepositoryStub({ list }));

    await useCase.execute({ page: 3, limit: 20, search: 'zombis' });

    expect(list).toHaveBeenCalledWith({ page: 3, limit: 20, search: 'zombis' }, undefined);
  });

  it('defaults to the empty filter', async () => {
    const list = vi.fn<EpisodeRepository['list']>().mockResolvedValue({ results: [], total: 0 });
    const useCase = new ListEpisodesUseCase(createEpisodeRepositoryStub({ list }));

    await useCase.execute();

    expect(list).toHaveBeenCalledWith({}, undefined);
  });

  it('⚠️ carries the caller’s AbortSignal down to the repository', async () => {
    const list = vi.fn<EpisodeRepository['list']>().mockResolvedValue({ results: [], total: 0 });
    const useCase = new ListEpisodesUseCase(createEpisodeRepositoryStub({ list }));
    const controller = new AbortController();

    await useCase.execute({ search: 'verite' }, controller.signal);

    expect(list).toHaveBeenCalledWith({ search: 'verite' }, controller.signal);
  });

  it('lets a repository error through as a DomainError', async () => {
    const list = vi
      .fn<EpisodeRepository['list']>()
      .mockRejectedValue(new NetworkError('Could not reach the server.'));
    const useCase = new ListEpisodesUseCase(createEpisodeRepositoryStub({ list }));

    await expect(useCase.execute({})).rejects.toBeInstanceOf(NetworkError);
  });
});
