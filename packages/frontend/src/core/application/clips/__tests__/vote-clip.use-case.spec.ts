import { describe, expect, it, vi } from 'vitest';
import type { ClipRepository } from '#/domain/clips/clip.repository';
import { NetworkError } from '#/domain/errors';
import { VoteClipUseCase } from '../vote-clip.use-case';
import { createClipRepositoryStub } from './clip-repository.stub';

describe('VoteClipUseCase', () => {
  it('casts the vote and reports what the server stored', async () => {
    const vote = vi
      .fn<ClipRepository['vote']>()
      .mockResolvedValue({ status: 'recorded', added: 1, removed: 0 });
    const useCase = new VoteClipUseCase(createClipRepositoryStub({ vote }));

    await expect(useCase.execute({ clipId: 178, value: 1 })).resolves.toEqual({
      status: 'recorded',
      added: 1,
      removed: 0,
    });
    expect(vote).toHaveBeenCalledWith(178, 1);
  });

  it('⚠️ RESOLVES on a repeated vote — it is an outcome, never a rejection', async () => {
    const vote = vi.fn<ClipRepository['vote']>().mockResolvedValue({ status: 'already-voted' });
    const useCase = new VoteClipUseCase(createClipRepositoryStub({ vote }));

    // The UI switches on this; if it ever became a throw, "ya has votado"
    // would land in the same error toast as the network being down.
    // ⚠️ `1`, and there is no other value: a vote is always positive.
    await expect(useCase.execute({ clipId: 178, value: 1 })).resolves.toEqual({
      status: 'already-voted',
    });
  });

  it('still rejects when the request itself fails', async () => {
    const vote = vi
      .fn<ClipRepository['vote']>()
      .mockRejectedValue(new NetworkError('Could not reach the server.'));
    const useCase = new VoteClipUseCase(createClipRepositoryStub({ vote }));

    await expect(useCase.execute({ clipId: 178, value: 1 })).rejects.toBeInstanceOf(NetworkError);
  });
});
