import type { AdminRepository } from '#/domain/auth/admin.repository';
import { ValidationError } from '#/domain/errors';
import type { Tag } from '#/domain/tags/tag.entity';

export interface RemoveClipTagInput {
  readonly clipId: number;
  readonly tag: Tag;
}

/**
 * Take a tag off a clip — the abusive-tag half of why this admin exists.
 *
 * ⚠️ The tag goes out as a **query parameter**, not a path segment: it is free
 * text and one containing a `/` would silently address a different route. The
 * adapter is where that is enforced; the rule is repeated here because this is
 * the layer people read first.
 */
export class RemoveClipTagUseCase {
  constructor(private readonly adminRepository: AdminRepository) {}

  // `async` so a rejected rule arrives as a rejected promise, like every other
  // failure — see `clips/create-clip.use-case.ts`.
  async execute({ clipId, tag }: RemoveClipTagInput): Promise<void> {
    if (tag === '') {
      throw new ValidationError('There is no tag to remove.');
    }

    return this.adminRepository.removeTag(clipId, tag);
  }
}
