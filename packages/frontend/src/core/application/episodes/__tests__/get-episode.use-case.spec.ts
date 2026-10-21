import { describe, expect, it, vi } from 'vitest';
import type { EpisodeDetail } from '#/domain/episodes/episode.entity';
import type { EpisodeRepository } from '#/domain/episodes/episode.repository';
import { NotFoundError } from '#/domain/errors';
import { GetEpisodeUseCase } from '../get-episode.use-case';

const EPISODE: EpisodeDetail = {
  id: 63,
  title: 'Episodio 86 (Spanish Zombies)',
  cover: 'https://example.invalid/cover.jpg',
  file: 'https://example.invalid/episode.mp3',
  originalUrl: 'https://example.invalid/episodio-86',
  date: new Date('2013-05-02T00:00:00.000Z'),
  clips: [
    {
      id: 178,
      title: 'La canción del zombi',
      start: 792,
      end: 870,
      tags: ['Absurdo'],
      up: 15,
    },
  ],
};

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

describe('GetEpisodeUseCase', () => {
  it('takes the numeric id — the `<id>-<slug>` URL is the router’s business', async () => {
    const findById = vi.fn<EpisodeRepository['findById']>().mockResolvedValue(EPISODE);
    const useCase = new GetEpisodeUseCase(createEpisodeRepositoryStub({ findById }));

    await expect(useCase.execute(63)).resolves.toEqual(EPISODE);
    expect(findById).toHaveBeenCalledWith(63, undefined);
  });

  it('surfaces a missing episode as NotFoundError', async () => {
    const findById = vi
      .fn<EpisodeRepository['findById']>()
      .mockRejectedValue(new NotFoundError('Not found'));
    const useCase = new GetEpisodeUseCase(createEpisodeRepositoryStub({ findById }));

    await expect(useCase.execute(999)).rejects.toBeInstanceOf(NotFoundError);
  });
});
