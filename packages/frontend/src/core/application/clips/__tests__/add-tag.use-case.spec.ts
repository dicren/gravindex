import { describe, expect, it, vi } from 'vitest';
import type { ClipRepository } from '#/domain/clips/clip.repository';
import { ValidationError } from '#/domain/errors';
import { AddTagUseCase } from '../add-tag.use-case';
import { createClipRepositoryStub } from './clip-repository.stub';

describe('AddTagUseCase', () => {
  it('sends the tag exactly as typed — accents, case and spaces included', async () => {
    // ⚠️ Normalizing a tag here would create one the library filter can never
    // select: matching is exact, case- and accent-sensitive.
    const addTag = vi
      .fn<ClipRepository['addTag']>()
      .mockResolvedValue({ status: 'added', tag: ' Anécdotas del Après ' });
    const useCase = new AddTagUseCase(createClipRepositoryStub({ addTag }));

    await useCase.execute({ clipId: 178, tag: ' Anécdotas del Après ' });

    expect(addTag).toHaveBeenCalledWith(178, ' Anécdotas del Après ');
  });

  it('⚠️ RESOLVES when the clip already carries the tag', async () => {
    // The backend answers 409 here (unlike the vote path's 201), and it still
    // must not reach the UI as an error: adding a tag that is already on the
    // card is an ordinary thing to do.
    const addTag = vi
      .fn<ClipRepository['addTag']>()
      .mockResolvedValue({ status: 'already-present', tag: 'Absurdo' });
    const useCase = new AddTagUseCase(createClipRepositoryStub({ addTag }));

    await expect(useCase.execute({ clipId: 178, tag: 'Absurdo' })).resolves.toEqual({
      status: 'already-present',
      tag: 'Absurdo',
    });
  });

  it.each(['', '   '])('rejects a tag with no text (%j) before the network', async (tag) => {
    const addTag = vi.fn<ClipRepository['addTag']>();
    const useCase = new AddTagUseCase(createClipRepositoryStub({ addTag }));

    await expect(useCase.execute({ clipId: 178, tag })).rejects.toBeInstanceOf(ValidationError);
    expect(addTag).not.toHaveBeenCalled();
  });
});
