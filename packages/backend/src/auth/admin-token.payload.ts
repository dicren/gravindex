/**
 * The payload of the one and only credential this application issues.
 *
 * ⚠️ `scope: 'admin'` is not decoration. It is the discriminator that lets
 * `AuthService.verifyAdminToken` refuse anything that was signed with this
 * secret but minted for some other purpose, should a second token type ever
 * exist. A token without it is rejected, so a future non-admin token cannot be
 * promoted by accident.
 *
 * ⚠️ It is also NOT related to the anonymous voter token (`X-Voter-Token`),
 * which is a client-generated UUID, unsigned, spoofable, and used only for
 * vote/tag deduplication. The two never meet: no guard here reads that header,
 * and nothing public reads this one.
 */
export interface AdminTokenPayload {
  /** `User.id`. */
  sub: number;
  username: string;
  scope: 'admin';
}
