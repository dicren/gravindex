import type { AdminRepository } from '#/domain/auth/admin.repository';

/**
 * Delete a clip and everything hanging off it.
 *
 * ⚠️ **There is no undo, and the id dies with it.** The backend does a hard
 * delete inside a transaction — the votes, the plays and the tags go too — and
 * never reuses the number. A clip id is a public URL (`/:id`), so this call
 * kills a link that may be shared where nobody can see it; two ids removed by
 * hand years ago still 404 today, which is what that looks like from outside.
 *
 * ⚠️ **No confirmation lives here.** Asking is a UI job and belongs next to the
 * button; a use case that popped a dialog could not be tested without a DOM and
 * would make the confirmation impossible to bypass in a future admin batch job.
 * What this layer owes the user is that the *caller* has said what will happen —
 * see `AdminClipView`'s dialog.
 */
export class DeleteAdminClipUseCase {
  constructor(private readonly adminRepository: AdminRepository) {}

  execute(clipId: number): Promise<void> {
    return this.adminRepository.deleteClip(clipId);
  }
}
