import { DeleteAdminClipUseCase } from '#/application/auth/delete-admin-clip.use-case';
import { GetAdminClipUseCase } from '#/application/auth/get-admin-clip.use-case';
import { LoginUseCase } from '#/application/auth/login.use-case';
import { LogoutUseCase } from '#/application/auth/logout.use-case';
import { RemoveClipTagUseCase } from '#/application/auth/remove-clip-tag.use-case';
import { RenameClipTagUseCase } from '#/application/auth/rename-clip-tag.use-case';
import { RestoreSessionUseCase } from '#/application/auth/restore-session.use-case';
import { UpdateAdminClipUseCase } from '#/application/auth/update-admin-clip.use-case';
import type { AdminTokenStore } from '#/domain/auth/admin-token.store';
import { AdminHttpRepository } from '#/infrastructure/auth/admin-http.repository';
import { AuthHttpRepository } from '#/infrastructure/auth/auth-http.repository';
import { SessionStorageAdminTokenStore } from '#/infrastructure/auth/session-storage-admin-token.store';

/**
 * Composition root for the admin surface: one token store, two repositories,
 * and the use cases built on them. Same shape as every other `*.config.ts` —
 * plain module-level singletons, no container.
 *
 * ⚠️ **This is the only file that names where the admin JWT lives**, exactly as
 * `identity.config.ts` is the only file that names where the anonymous voter
 * token lives. Nothing in `vue/` imports either adapter; the store below is not
 * exported at all, so a component cannot reach the credential even by accident
 * — it goes through a use case or it does not go.
 *
 * ⚠️ **One instance, not one per repository.** With `sessionStorage` as the
 * source of truth every instance would agree, but the memory fallback used when
 * storage is unavailable is per-instance: two of those would have the login
 * write a token the admin adapter could never read, and every admin screen
 * would report an expired session immediately after a successful login.
 *
 * ⚠️ **The two identities never meet here either.** This file does not import
 * `identity.config.ts` and must not: a voter token is an anonymous,
 * client-supplied deduplication hint, and no admin route trusts one.
 */
const adminTokenStore: AdminTokenStore = new SessionStorageAdminTokenStore();

const authRepository = new AuthHttpRepository(adminTokenStore);
const adminRepository = new AdminHttpRepository(adminTokenStore);

export const loginUseCase = new LoginUseCase(authRepository, adminTokenStore);
export const logoutUseCase = new LogoutUseCase(adminTokenStore);
export const restoreSessionUseCase = new RestoreSessionUseCase(authRepository, adminTokenStore);

export const getAdminClipUseCase = new GetAdminClipUseCase(adminRepository);
export const updateAdminClipUseCase = new UpdateAdminClipUseCase(adminRepository);
export const deleteAdminClipUseCase = new DeleteAdminClipUseCase(adminRepository);
export const renameClipTagUseCase = new RenameClipTagUseCase(adminRepository);
export const removeClipTagUseCase = new RemoveClipTagUseCase(adminRepository);
