import { DomainError } from '#/domain/errors';
import type { ClipRepository } from '#/domain/clips/clip.repository';

/**
 * Append one play to a clip's counter.
 *
 * ⚠️ **It never rejects.** "Fire-and-forget" is the contract the card relies
 * on: the counter is written when playback starts, nothing in the app ever
 * reads it back, and a failed count must not interrupt the audio or raise a
 * toast at someone who only pressed play. Swallowing is therefore a decision,
 * not sloppiness — and it is confined to this one use case so that no other
 * write inherits it.
 *
 * Only `DomainError`s are swallowed: a `TypeError` from a bug in our own code
 * still surfaces.
 */
export class RegisterPlayUseCase {
  constructor(private readonly clipRepository: ClipRepository) {}

  async execute(clipId: number): Promise<void> {
    try {
      await this.clipRepository.registerPlay(clipId);
    } catch (error) {
      if (error instanceof DomainError) {
        return;
      }
      throw error;
    }
  }
}
