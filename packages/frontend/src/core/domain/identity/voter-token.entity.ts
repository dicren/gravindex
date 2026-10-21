/**
 * The anonymous voter token: a random UUID this browser generates once and
 * sends on every write (vote, create clip, add tag). It is not the visitor's
 * IP address and not anything else personal — root `AGENTS.md`, "Identity: an
 * anonymous token".
 *
 * ⚠️ **Random, and derived from nothing.** Not a fingerprint, not a hash of
 * anything about the person, the device or the session. The moment it derives
 * from the visitor it becomes personal data, which is the entire point of
 * keeping it anonymous.
 *
 * ⚠️ **Losing it is normal, not an error.** Cleared storage, a private window
 * and a second browser each produce a fresh token, and the app must behave
 * perfectly when that happens — it only means a vote can be cast once more.
 * Never surface it to the user, never try to "recover" it, and never add a
 * second identifier to make it stickier.
 *
 * ⚠️ It is **not** the admin JWT: this is an anonymous deduplication hint the
 * backend never authorises on (see `common/http/voter-token.decorator.ts`),
 * that one is a credential. And it is **not** an analytics id — GA4 brings its
 * own, gated behind consent, and the two must never be joined.
 */
export type VoterToken = string;

/**
 * The header the backend reads it from. Lowercase because that is the constant
 * the backend declares (`VOTER_TOKEN_HEADER` in
 * `packages/backend/src/common/http/voter-token.decorator.ts`) and the key the
 * OpenAPI-generated client types expect; HTTP header names are
 * case-insensitive, so the casing is a convention, not a requirement.
 */
export const VOTER_TOKEN_HEADER = 'x-voter-token';

/**
 * Shape only: 8-4-4-4-12 hex, deliberately not version- or variant-strict —
 * the same rule the backend applies, so a token this app considers valid is
 * never one the API answers `400` to.
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a value read back from storage can still be sent as a token.
 *
 * ⚠️ Worth checking, and not defensive noise: `localStorage` is shared with
 * whatever else this origin ever wrote, is editable by hand, and a malformed
 * value would earn a `400` from the backend on every single write. A value that
 * fails this is simply replaced — losing a token is normal.
 */
export function isVoterToken(value: unknown): value is VoterToken {
  return typeof value === 'string' && UUID_SHAPE.test(value);
}
