import { vi } from 'vitest';
import type { ClipRepository } from '#/domain/clips/clip.repository';

/**
 * ⚠️ Typed by the PORT, with one `vi.fn<Port['method']>()` per member and an
 * `overrides` spread — the same shape as the tags slice's stub, shared here
 * because seven use cases lean on the same seven-method interface.
 *
 * Typing it as `ClipRepository` is what makes it useful: add a method to the
 * port and every spec stops compiling until it is accounted for.
 */
export function createClipRepositoryStub(overrides: Partial<ClipRepository> = {}): ClipRepository {
  return {
    list: vi.fn<ClipRepository['list']>(),
    findById: vi.fn<ClipRepository['findById']>(),
    listRelated: vi.fn<ClipRepository['listRelated']>(),
    create: vi.fn<ClipRepository['create']>(),
    registerPlay: vi.fn<ClipRepository['registerPlay']>(),
    vote: vi.fn<ClipRepository['vote']>(),
    addTag: vi.fn<ClipRepository['addTag']>(),
    ...overrides,
  };
}
