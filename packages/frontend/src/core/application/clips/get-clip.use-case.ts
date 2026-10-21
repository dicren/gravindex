import type { Clip } from '#/domain/clips/clip.entity';
import type { ClipRepository } from '#/domain/clips/clip.repository';

/**
 * One clip, by the id in its permalink.
 *
 * ⚠️ The result carries `up`, because the permalink and the player show a vote
 * count for a clip opened by URL, and the endpoint is the only source for it.
 * No `points`: with a single positive vote it would be a second name for the
 * same number.
 */
export class GetClipUseCase {
  constructor(private readonly clipRepository: ClipRepository) {}

  execute(clipId: number, signal?: AbortSignal): Promise<Clip> {
    return this.clipRepository.findById(clipId, signal);
  }
}
