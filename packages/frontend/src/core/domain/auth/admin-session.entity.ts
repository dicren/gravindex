/**
 * The admin session: the one authenticated identity in an app that otherwise
 * has none.
 *
 * ⚠️ **This is NOT the anonymous voter token, and the two must never meet.**
 * `domain/identity/voter-token.entity.ts` is a random UUID this browser mints
 * for itself, sent on writes so the backend can deduplicate a vote; it is
 * client-supplied, spoofable, and no admin route trusts it. What lives here is
 * a **credential** the server issued after checking a password. They travel in
 * different headers (`X-Voter-Token` vs `Authorization: Bearer`), live in
 * different storages (`localStorage` vs `sessionStorage`) and are read by
 * different adapters. Nothing in this slice may fall back to the other one, and
 * the voter token must never be sent as authentication — the backend has a test
 * asserting an admin route rejects a request carrying only a voter token, and
 * this client must never be the thing that tries it.
 */

/**
 * The JWT itself, opaque to this app.
 *
 * ⚠️ Never parsed here. It is a bearer token: the only thing the client can
 * truthfully say about it is whether the server still accepts it, which is what
 * `GET /api/admin/me` answers. Reading its `exp` claim to pre-empt an expiry
 * would mean trusting a value we cannot verify, and would still be wrong the
 * moment the `user` row is deleted — the token stays syntactically valid and
 * stops working.
 */
export type AdminToken = string;

/** What the login form collects. */
export interface AdminCredentials {
  readonly username: string;
  readonly password: string;
}

/** Who the token belongs to, as `GET /api/admin/me` reports it. */
export interface AdminIdentity {
  readonly id: number;
  readonly username: string;
}

/** What a successful login yields: the credential plus the name to greet. */
export interface AdminSession {
  readonly token: AdminToken;
  readonly username: string;
}

/**
 * The answer to "is there still a usable session in this browser?".
 *
 * ⚠️ Three outcomes, not two, and the third is the one that is easy to get
 * wrong. A token that could not be **checked** — the server was unreachable —
 * is not a token that was **rejected**. Collapsing the two would log an admin
 * out because their wifi blinked, and would throw away a perfectly good
 * credential while doing it.
 */
export type RestoreSessionOutcome =
  /** A token was present and the server confirmed it. */
  | { readonly status: 'authenticated'; readonly identity: AdminIdentity }
  /** No token, or the server refused the one we had — which has now been erased. */
  | { readonly status: 'anonymous' }
  /** A token is held but unproven: the probe never got an answer. Keep it. */
  | { readonly status: 'unverified' };
