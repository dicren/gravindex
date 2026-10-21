import type { ClipListItem } from '#/domain/clips/clip.entity';
import type { ClipRepository } from '#/domain/clips/clip.repository';

/**
 * The `Relacionados · comparten tag` strip under a clip permalink.
 *
 * ⚠️ Ordered by how many tags the two clips SHARE, which is a decision made in
 * SQL and not here (see `ClipRepository.listRelated`). Nothing in this layer
 * re-ranks, truncates or filters the answer: the strip renders what the server
 * chose, and an empty answer means the section does not render at all.
 */
export class ListRelatedClipsUseCase {
  constructor(private readonly clipRepository: ClipRepository) {}

  execute(clipId: number, signal?: AbortSignal): Promise<ClipListItem[]> {
    return this.clipRepository.listRelated(clipId, signal);
  }
}
