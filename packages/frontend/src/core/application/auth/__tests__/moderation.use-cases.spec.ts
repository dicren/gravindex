import { describe, expect, it, vi } from 'vitest';
import type { AdminClip } from '#/domain/auth/admin-clip.entity';
import type { AdminRepository } from '#/domain/auth/admin.repository';
import { ValidationError } from '#/domain/errors';
import { DeleteAdminClipUseCase } from '../delete-admin-clip.use-case';
import { GetAdminClipUseCase } from '../get-admin-clip.use-case';
import { RemoveClipTagUseCase } from '../remove-clip-tag.use-case';
import { RenameClipTagUseCase } from '../rename-clip-tag.use-case';
import { UpdateAdminClipUseCase } from '../update-admin-clip.use-case';

const CLIP: AdminClip = {
  id: 182,
  title: 'La mulata del clítor...',
  start: 792,
  end: 870,
  episodeId: 63,
  tags: ['Mulata', 'Anécdotas'],
};

function adminRepositoryStub(overrides: Partial<AdminRepository> = {}): AdminRepository {
  return {
    getClip: vi.fn().mockResolvedValue(CLIP),
    updateClip: vi.fn().mockResolvedValue(CLIP),
    deleteClip: vi.fn().mockResolvedValue(undefined),
    renameTag: vi.fn().mockResolvedValue(CLIP),
    removeTag: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('GetAdminClipUseCase', () => {
  it('returns the flat admin shape', async () => {
    await expect(new GetAdminClipUseCase(adminRepositoryStub()).execute(182)).resolves.toEqual(
      CLIP,
    );
  });
});

describe('UpdateAdminClipUseCase', () => {
  it('passes only the fields that were given', async () => {
    const repository = adminRepositoryStub();
    await new UpdateAdminClipUseCase(repository).execute({
      clipId: 182,
      changes: { title: 'Un título arreglado' },
    });

    expect(repository.updateClip).toHaveBeenCalledWith(182, { title: 'Un título arreglado' });
  });

  it('refuses a change set with nothing in it — a 200 that changed nothing reads as "saved"', async () => {
    const repository = adminRepositoryStub();

    await expect(
      new UpdateAdminClipUseCase(repository).execute({ clipId: 182, changes: {} }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(repository.updateClip).not.toHaveBeenCalled();
  });

  it('refuses a blank title and a fractional offset', async () => {
    const useCase = new UpdateAdminClipUseCase(adminRepositoryStub());

    await expect(
      useCase.execute({ clipId: 182, changes: { title: '   ' } }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(useCase.execute({ clipId: 182, changes: { start: 12.5 } })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('does NOT second-guess `end > start`: only the server has the other half', async () => {
    const repository = adminRepositoryStub();
    // `start` alone, higher than the stored `end` for all this layer knows.
    await new UpdateAdminClipUseCase(repository).execute({
      clipId: 182,
      changes: { start: 9_999 },
    });

    expect(repository.updateClip).toHaveBeenCalledWith(182, { start: 9_999 });
  });
});

describe('DeleteAdminClipUseCase', () => {
  it('deletes without asking anything — confirming is the UI’s job', async () => {
    const repository = adminRepositoryStub();
    await new DeleteAdminClipUseCase(repository).execute(182);
    expect(repository.deleteClip).toHaveBeenCalledWith(182);
  });
});

describe('RenameClipTagUseCase', () => {
  it('sends the new tag exactly as typed, accents and all', async () => {
    const repository = adminRepositoryStub();
    await new RenameClipTagUseCase(repository).execute({
      clipId: 182,
      tag: 'Anecdotas',
      newTag: '  Anécdotas ',
    });

    // ⚠️ Not trimmed. A tag is matched byte for byte by `GET /clips?tags=…`,
    // so tidying it here would mint one the filter can never select.
    expect(repository.renameTag).toHaveBeenCalledWith(182, {
      tag: 'Anecdotas',
      newTag: '  Anécdotas ',
    });
  });

  it('refuses a new tag with no characters at all', async () => {
    const repository = adminRepositoryStub();

    await expect(
      new RenameClipTagUseCase(repository).execute({ clipId: 182, tag: 'Mulata', newTag: '   ' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(repository.renameTag).not.toHaveBeenCalled();
  });
});

describe('RemoveClipTagUseCase', () => {
  it('takes the tag off the clip', async () => {
    const repository = adminRepositoryStub();
    await new RemoveClipTagUseCase(repository).execute({ clipId: 182, tag: 'Mulata' });
    expect(repository.removeTag).toHaveBeenCalledWith(182, 'Mulata');
  });
});
