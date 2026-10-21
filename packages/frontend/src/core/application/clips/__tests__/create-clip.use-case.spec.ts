import { describe, expect, it, vi } from 'vitest';
import type { ClipRepository, NewClip } from '#/domain/clips/clip.repository';
import { ValidationError } from '#/domain/errors';
import { CreateClipUseCase } from '../create-clip.use-case';
import { createClipRepositoryStub } from './clip-repository.stub';

const DRAFT: NewClip = {
  episodeId: 63,
  title: 'La canción del zombi',
  start: 792,
  end: 870,
  tags: ['Absurdo', 'Anécdotas'],
};

function useCaseWith(create = vi.fn<ClipRepository['create']>()) {
  return { create, useCase: new CreateClipUseCase(createClipRepositoryStub({ create })) };
}

describe('CreateClipUseCase', () => {
  it('publishes a well-formed draft', async () => {
    const { create, useCase } = useCaseWith();

    await useCase.execute(DRAFT);

    expect(create).toHaveBeenCalledWith(DRAFT);
  });

  it.each([
    ['an end at or before the start', { ...DRAFT, end: DRAFT.start }],
    ['a fractional boundary', { ...DRAFT, end: 870.5 }],
    ['a negative start', { ...DRAFT, start: -1, end: 10 }],
    ['an empty title', { ...DRAFT, title: '' }],
    ['no episode', { ...DRAFT, episodeId: 0 }],
  ])('rejects %s before it reaches the network', async (_case, draft) => {
    const { create, useCase } = useCaseWith();

    await expect(useCase.execute(draft)).rejects.toBeInstanceOf(ValidationError);
    expect(create).not.toHaveBeenCalled();
  });

  it('does not invent rules the API does not have', async () => {
    // ⚠️ The backend accepts a whitespace-only title and tags with any casing or
    // accents. Being stricter here would silently change what the API accepts.
    const { create, useCase } = useCaseWith();
    const odd = { ...DRAFT, title: '   ', tags: ['después', 'Después'] };

    await useCase.execute(odd);

    expect(create).toHaveBeenCalledWith(odd);
  });

  it('rejects with a promise rather than throwing synchronously', async () => {
    const { useCase } = useCaseWith();

    // A caller that only wrote `.catch()` must still catch it.
    await expect(useCase.execute({ ...DRAFT, title: '' })).rejects.toBeInstanceOf(ValidationError);
  });
});
