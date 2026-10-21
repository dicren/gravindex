import type { AdminToken } from '#/domain/auth/admin-session.entity';
import type { AdminTokenStore } from '#/domain/auth/admin-token.store';

/**
 * An `AdminTokenStore` that lives in a variable — the whole point of the port
 * being a port. Every use-case spec in this folder runs with no browser
 * storage, no `sessionStorage` and no adapter.
 *
 * ⚠️ Not a test file: Vitest only collects `*.spec.ts`, so this sits alongside
 * them the way `clips/__tests__/clip-repository.stub.ts` does.
 */
export function tokenStoreStub(initial: AdminToken | null = null): AdminTokenStore & {
  current: AdminToken | null;
} {
  return {
    current: initial,
    read() {
      return this.current;
    },
    write(token: AdminToken) {
      this.current = token;
    },
    clear() {
      this.current = null;
    },
  };
}
