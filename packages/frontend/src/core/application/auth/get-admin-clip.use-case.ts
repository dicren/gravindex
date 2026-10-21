import type { AdminClip } from '#/domain/auth/admin-clip.entity';
import type { AdminRepository } from '#/domain/auth/admin.repository';

/**
 * The clip an admin is about to edit, in the flat admin shape.
 *
 * ⚠️ Not `GetClipUseCase`. The public endpoint returns a populated episode and
 * no vote counts; this one returns an `episodeId` and the tags, and it is
 * behind the guard. Two endpoints, two use cases, no shared "just add a token"
 * flag — which is what keeps an authenticated call from ever being made by
 * accident from a public screen.
 */
export class GetAdminClipUseCase {
  constructor(private readonly adminRepository: AdminRepository) {}

  execute(clipId: number, signal?: AbortSignal): Promise<AdminClip> {
    return this.adminRepository.getClip(clipId, signal);
  }
}
