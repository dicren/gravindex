import type { AddTagOutcome } from '#/domain/clips/clip.entity';
import type { ClipRepository } from '#/domain/clips/clip.repository';
import { ValidationError } from '#/domain/errors';
import type { Tag } from '#/domain/tags/tag.entity';

export interface AddTagInput {
  readonly clipId: number;
  readonly tag: Tag;
}

/**
 * Attach a tag to a clip.
 *
 * ⚠️ The tag travels **exactly as typed**. It is not trimmed, lower-cased or
 * stripped of accents anywhere: a tag IS its string, `GET /clips?tags=…`
 * matches it byte for byte, and normalizing here would create a tag the
 * library's filter can never select. The only thing rejected is a tag with no
 * characters in it at all, which the API refuses too.
 *
 * A repeat comes back as `{ status: 'already-present' }` rather than an error —
 * see `AddTagOutcome` for why the 409 stops in the adapter.
 */
export class AddTagUseCase {
  constructor(private readonly clipRepository: ClipRepository) {}

  // `async` so a rejected tag rejects the promise instead of throwing
  // synchronously — see `create-clip.use-case.ts`.
  async execute({ clipId, tag }: AddTagInput): Promise<AddTagOutcome> {
    if (tag.trim() === '') {
      throw new ValidationError('A tag needs some text.');
    }

    return this.clipRepository.addTag(clipId, tag);
  }
}
