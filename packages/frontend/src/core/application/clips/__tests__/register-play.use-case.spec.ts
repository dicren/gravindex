import { describe, expect, it, vi } from 'vitest';
import type { ClipRepository } from '#/domain/clips/clip.repository';
import { NetworkError } from '#/domain/errors';
import { RegisterPlayUseCase } from '../register-play.use-case';
import { createClipRepositoryStub } from './clip-repository.stub';

describe('RegisterPlayUseCase', () => {
  it('appends one play', async () => {
    const registerPlay = vi.fn<ClipRepository['registerPlay']>().mockResolvedValue(undefined);
    const useCase = new RegisterPlayUseCase(createClipRepositoryStub({ registerPlay }));

    await expect(useCase.execute(178)).resolves.toBeUndefined();
    expect(registerPlay).toHaveBeenCalledWith(178);
  });

  it('⚠️ swallows a failed count — playback must not break over a counter', async () => {
    const registerPlay = vi
      .fn<ClipRepository['registerPlay']>()
      .mockRejectedValue(new NetworkError('Could not reach the server.'));
    const useCase = new RegisterPlayUseCase(createClipRepositoryStub({ registerPlay }));

    await expect(useCase.execute(178)).resolves.toBeUndefined();
  });

  it('does not swallow a bug in our own code', async () => {
    // Only `DomainError`s are fire-and-forget; a `TypeError` is a defect and
    // must still be loud.
    const registerPlay = vi
      .fn<ClipRepository['registerPlay']>()
      .mockRejectedValue(new TypeError('clip is not defined'));
    const useCase = new RegisterPlayUseCase(createClipRepositoryStub({ registerPlay }));

    await expect(useCase.execute(178)).rejects.toBeInstanceOf(TypeError);
  });
});
