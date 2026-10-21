import { describe, expect, it, vi } from 'vitest';
import type { EpisodeListItem } from '#/domain/episodes/episode.entity';
import type { EpisodeRepository } from '#/domain/episodes/episode.repository';
import { ListAllEpisodesUseCase } from '../list-all-episodes.use-case';

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

function episode(id: number): EpisodeListItem {
  return {
    id,
    title: `Episodio ${id}`,
    cover: 'https://example.test/cover.png',
    file: 'https://example.test/audio.mp3',
    originalUrl: 'https://example.test/episodio',
    date: new Date('2011-07-25T10:00:00.000Z'),
    clipCount: 0,
  };
}

/** `total` rows spread over pages of 100, the way the API answers. */
function pagedRepository(total: number): EpisodeRepository['list'] {
  return vi.fn<EpisodeRepository['list']>().mockImplementation((query) => {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const from = (page - 1) * limit;
    const ids = Array.from({ length: Math.max(0, Math.min(limit, total - from)) }, (_, i) =>
      episode(from + i + 1),
    );
    return Promise.resolve({ results: ids, total });
  });
}

describe('ListAllEpisodesUseCase', () => {
  it('asks for pages of 100 until it has them all', async () => {
    const list = pagedRepository(580);
    const useCase = new ListAllEpisodesUseCase(createEpisodeRepositoryStub({ list }));

    const episodes = await useCase.execute();

    expect(episodes).toHaveLength(580);
    // 580 rows at 100 a page: six requests, and not a seventh to discover the end.
    expect(list).toHaveBeenCalledTimes(6);
    expect(list).toHaveBeenNthCalledWith(1, { page: 1, limit: 100 }, undefined);
    expect(list).toHaveBeenNthCalledWith(6, { page: 6, limit: 100 }, undefined);
  });

  it('⚠️ stops on the exact multiple instead of asking one page too many', async () => {
    const list = pagedRepository(200);
    const useCase = new ListAllEpisodesUseCase(createEpisodeRepositoryStub({ list }));

    await expect(useCase.execute()).resolves.toHaveLength(200);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('carries the filter into every page', async () => {
    const list = pagedRepository(150);
    const useCase = new ListAllEpisodesUseCase(createEpisodeRepositoryStub({ list }));

    await useCase.execute({ search: 'zombis', withClips: true });

    expect(list).toHaveBeenNthCalledWith(
      2,
      { search: 'zombis', withClips: true, page: 2, limit: 100 },
      undefined,
    );
  });

  it('⚠️ carries the caller’s AbortSignal down to every request', async () => {
    const list = pagedRepository(150);
    const useCase = new ListAllEpisodesUseCase(createEpisodeRepositoryStub({ list }));
    const controller = new AbortController();

    await useCase.execute({}, controller.signal);

    expect(list).toHaveBeenNthCalledWith(1, expect.anything(), controller.signal);
    expect(list).toHaveBeenNthCalledWith(2, expect.anything(), controller.signal);
  });

  it('answers an empty list without a second request', async () => {
    const list = pagedRepository(0);
    const useCase = new ListAllEpisodesUseCase(createEpisodeRepositoryStub({ list }));

    await expect(useCase.execute()).resolves.toEqual([]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('⚠️ gives up at the page cap rather than looping for ever on a lying total', async () => {
    // A server that reports more rows than it will ever serve: without the cap
    // this is a request loop with no end.
    const list = vi
      .fn<EpisodeRepository['list']>()
      .mockResolvedValue({ results: [episode(1)], total: 9999 });
    const useCase = new ListAllEpisodesUseCase(createEpisodeRepositoryStub({ list }));

    await expect(useCase.execute()).resolves.toHaveLength(20);
    expect(list).toHaveBeenCalledTimes(20);
  });
});
