import { describe, expect, it, vi } from 'vitest';
import type { Clip } from '#/domain/clips/clip.entity';
import type { ClipRepository } from '#/domain/clips/clip.repository';
import { NotFoundError } from '#/domain/errors';
import { GetClipUseCase } from '../get-clip.use-case';
import { createClipRepositoryStub } from './clip-repository.stub';

const CLIP: Clip = {
  id: 178,
  title: 'La canción del zombi',
  start: 792,
  end: 870,
  episode: {
    id: 63,
    title: 'Episodio 86 (Spanish Zombies)',
    cover: 'https://example.invalid/cover.jpg',
    file: 'https://example.invalid/episode.mp3',
    originalUrl: 'https://example.invalid/episodio-86',
    date: new Date('2013-05-02T00:00:00.000Z'),
  },
  tags: ['Absurdo'],
  up: 12,
};

describe('GetClipUseCase', () => {
  it('returns the clip the repository yields', async () => {
    const findById = vi.fn<ClipRepository['findById']>().mockResolvedValue(CLIP);
    const useCase = new GetClipUseCase(createClipRepositoryStub({ findById }));

    await expect(useCase.execute(178)).resolves.toEqual(CLIP);
    expect(findById).toHaveBeenCalledWith(178, undefined);
  });

  // ⚠️ The endpoint answers `up` alongside the clip, and the permalink needs it
  // for its vote button. No `points`: with a single positive vote it would be a
  // second name for the same number.
  it('yields a clip carrying `up` and no `points`', async () => {
    const findById = vi.fn<ClipRepository['findById']>().mockResolvedValue(CLIP);
    const useCase = new GetClipUseCase(createClipRepositoryStub({ findById }));

    const clip = await useCase.execute(178);
    expect(clip.up).toBe(CLIP.up);
    expect(clip).not.toHaveProperty('points');
  });

  it('surfaces a missing clip as NotFoundError, not as a generic failure', async () => {
    // Two ids were deleted by hand years ago and their links are still shared.
    const findById = vi
      .fn<ClipRepository['findById']>()
      .mockRejectedValue(new NotFoundError('Not found'));
    const useCase = new GetClipUseCase(createClipRepositoryStub({ findById }));

    await expect(useCase.execute(4)).rejects.toBeInstanceOf(NotFoundError);
  });
});
