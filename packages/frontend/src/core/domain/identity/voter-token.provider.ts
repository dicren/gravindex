import type { VoterToken } from './voter-token.entity';

/**
 * Port for "who is submitting this", implemented by
 * `infrastructure/identity/local-storage-voter-token.provider.ts`.
 *
 * ⚠️ This is the interface every repository that writes takes in its
 * constructor — voting, creating a clip, adding a tag. Depend on it, never on
 * the adapter: that is what lets those repositories be tested with
 * `{ getToken: () => 'a-fixed-uuid' }` and no browser storage at all.
 *
 * Synchronous on purpose. Reading `localStorage` is synchronous, the token has
 * no server behind it, and a promise here would force every caller — including
 * a `beforeRequest` hook — to become async for nothing.
 *
 * It always returns a token: there is no "not yet" state and no error state.
 * When there is nothing stored, or storage cannot be read at all, the adapter
 * mints a fresh one. Callers never handle absence, because absence is not a
 * failure — see `voter-token.entity.ts`.
 */
export interface VoterTokenProvider {
  getToken(): VoterToken;
}
