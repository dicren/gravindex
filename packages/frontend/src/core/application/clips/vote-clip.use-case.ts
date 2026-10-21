import type { ClipRepository } from '#/domain/clips/clip.repository';
import type { VoteOutcome, VoteValue } from '#/domain/clips/vote.entity';

export interface VoteClipInput {
  readonly clipId: number;
  readonly value: VoteValue;
}

/**
 * Vote a clip up or down.
 *
 * ⚠️ **A repeated vote is not a failure.** It resolves as
 * `{ status: 'already-voted' }` rather than rejecting, because that is what the
 * API says (an ordinary 201 carrying `error: 'you have already voted'`) and
 * what the UI shows. Turning it into an exception would put an everyday user
 * action in the same bucket as the network being down.
 *
 * The token that deduplicates the vote is the adapter's business — see
 * `ClipRepository` — so this use case is as thin as the read ones.
 */
export class VoteClipUseCase {
  constructor(private readonly clipRepository: ClipRepository) {}

  execute({ clipId, value }: VoteClipInput): Promise<VoteOutcome> {
    return this.clipRepository.vote(clipId, value);
  }
}
