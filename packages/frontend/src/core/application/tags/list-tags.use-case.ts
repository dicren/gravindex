import type { TagCount } from '#/domain/tags/tag.entity';
import type { TagRepository } from '#/domain/tags/tag.repository';

/**
 * ⚠️ The template every use case copies: a class, its port injected through the
 * constructor, a single `execute()`, and **no framework anywhere**. It is a
 * plain async call — Pinia Colada's caching, deduplication and loading state
 * wrap it from `vue/`, they never live in here.
 */
export class ListTagsUseCase {
  constructor(private readonly tagRepository: TagRepository) {}

  execute(signal?: AbortSignal): Promise<TagCount[]> {
    return this.tagRepository.listAll(signal);
  }
}
