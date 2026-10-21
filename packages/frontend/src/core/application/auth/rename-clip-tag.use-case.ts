import type { AdminClip, TagRename } from '#/domain/auth/admin-clip.entity';
import type { AdminRepository } from '#/domain/auth/admin.repository';
import { ValidationError } from '#/domain/errors';

export interface RenameClipTagInput extends TagRename {
  readonly clipId: number;
}

/**
 * Rename one tag **on one clip**.
 *
 * ⚠️ Not a site-wide rename: a tag is the `(clip, tag)` pair and there is no
 * tag table, so "rename Zombies everywhere" is not an operation the API has.
 *
 * ⚠️ The new tag is stored **exactly as typed** — not trimmed, not lower-cased,
 * not stripped of accents. Tags are matched byte for byte by
 * `GET /clips?tags=…`, so normalizing here would quietly produce a tag the
 * library's filter can never select. Only "no characters at all" is refused,
 * which is what the API refuses too.
 */
export class RenameClipTagUseCase {
  constructor(private readonly adminRepository: AdminRepository) {}

  // `async` so a rejected rule arrives as a rejected promise, like every other
  // failure — see `clips/create-clip.use-case.ts`.
  async execute({ clipId, tag, newTag }: RenameClipTagInput): Promise<AdminClip> {
    if (tag === '') {
      throw new ValidationError('There is no tag to rename.');
    }
    if (newTag.trim() === '') {
      throw new ValidationError('A tag needs some text.');
    }

    return this.adminRepository.renameTag(clipId, { tag, newTag });
  }
}
