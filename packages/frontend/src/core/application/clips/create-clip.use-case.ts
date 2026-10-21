import type { Clip } from '#/domain/clips/clip.entity';
import type { ClipRepository, NewClip } from '#/domain/clips/clip.repository';
import { ValidationError } from '#/domain/errors';

/**
 * Publish a new clip cut from an episode.
 *
 * The rules below are the backend's own (`CreateClipDto`), checked here so the
 * editor can say what is wrong without a round trip — ⚠️ **not** a stricter
 * set. A whitespace-only title, for instance, is accepted by the API and is
 * accepted here too: inventing extra rules would make this layer stricter than
 * the API, and this layer is not the place to decide the app should have them.
 *
 * ⚠️ No token anywhere in this file. The submitter trail is attached by the
 * adapter from its injected provider — see `ClipRepository`.
 */
export class CreateClipUseCase {
  constructor(private readonly clipRepository: ClipRepository) {}

  // `async` so a rejected rule arrives as a rejected promise like every other
  // failure — a synchronous `throw` from a method that returns one is a trap
  // for any caller that only wrote `.catch()`.
  async execute(draft: NewClip): Promise<Clip> {
    if (!Number.isInteger(draft.start) || draft.start < 0) {
      throw new ValidationError('A clip starts at a whole, non-negative number of seconds.');
    }
    if (!Number.isInteger(draft.end) || draft.end <= draft.start) {
      throw new ValidationError('A clip must end after it starts.');
    }
    if (draft.title === '') {
      throw new ValidationError('A clip needs a title.');
    }
    if (!Number.isInteger(draft.episodeId) || draft.episodeId < 1) {
      throw new ValidationError('A clip must be cut from an episode.');
    }

    return this.clipRepository.create(draft);
  }
}
