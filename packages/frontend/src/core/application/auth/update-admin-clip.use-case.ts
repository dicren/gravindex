import type { AdminClip, AdminClipChanges } from '#/domain/auth/admin-clip.entity';
import type { AdminRepository } from '#/domain/auth/admin.repository';
import { ValidationError } from '#/domain/errors';

export interface UpdateAdminClipInput {
  readonly clipId: number;
  readonly changes: AdminClipChanges;
}

/**
 * Edit a clip's title or its cut.
 *
 * The rules restated below are the backend's own (`UpdateClipDto`): a blank
 * title is refused, and the offsets are whole non-negative seconds. ⚠️ What is
 * **not** restated is `end > start`, and that is deliberate — a PATCH may carry
 * only one of the two, so the rule needs the stored value of the other and only
 * the server has it. It answers 400 with its own explanation and the form shows
 * that. Guessing here from a possibly stale copy of the clip would refuse edits
 * that are in fact valid.
 *
 * ⚠️ An empty `changes` is refused rather than sent. The API would accept it
 * and answer 200 with the clip unchanged, which reads to the user as "saved"
 * when nothing was.
 */
export class UpdateAdminClipUseCase {
  constructor(private readonly adminRepository: AdminRepository) {}

  // `async` so a rejected rule arrives as a rejected promise, like every other
  // failure — see `clips/create-clip.use-case.ts`.
  async execute({ clipId, changes }: UpdateAdminClipInput): Promise<AdminClip> {
    if (Object.values(changes).every((value) => value === undefined)) {
      throw new ValidationError('Nothing to change.');
    }
    if (changes.title !== undefined && changes.title.trim() === '') {
      throw new ValidationError('A clip needs a title.');
    }
    if (changes.start !== undefined && (!Number.isInteger(changes.start) || changes.start < 0)) {
      throw new ValidationError('A clip starts at a whole, non-negative number of seconds.');
    }
    if (changes.end !== undefined && (!Number.isInteger(changes.end) || changes.end < 1)) {
      throw new ValidationError('A clip ends at a whole number of seconds, after the first.');
    }

    return this.adminRepository.updateClip(clipId, changes);
  }
}
