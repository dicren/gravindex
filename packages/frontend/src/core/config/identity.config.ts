import type { VoterTokenProvider } from '#/domain/identity/voter-token.provider';
import { LocalStorageVoterTokenProvider } from '#/infrastructure/identity/local-storage-voter-token.provider';

/**
 * Composition root for identity: one provider instance for the whole app.
 *
 * ⚠️ **This is the only import path anything else should use.** Repositories
 * that write — vote, create a clip, add a tag — take a `VoterTokenProvider` in
 * their constructor, and their own `*.config.ts` passes this instance in:
 *
 * ```ts
 * import { voterTokenProvider } from './identity.config';
 * const clipRepository = new ClipHttpRepository(voterTokenProvider);
 * ```
 *
 * Inside the repository the token becomes one header, whose name is
 * `VOTER_TOKEN_HEADER` from `#/domain/identity/voter-token.entity` — the same
 * key the generated client's typed `headers` object expects.
 *
 * One instance, not one per repository: with `localStorage` as the source of
 * truth every instance would agree anyway, but the memory fallback used when
 * storage is unavailable is per-instance, and two of those would hand out two
 * different tokens in the same private window.
 */
export const voterTokenProvider: VoterTokenProvider = new LocalStorageVoterTokenProvider();
