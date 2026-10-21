import { ListTagsUseCase } from '#/application/tags/list-tags.use-case';
import { TagHttpRepository } from '#/infrastructure/tags/tag-http.repository';

/**
 * Composition root for the tags feature: one repository instance, shared by
 * every use case built on it.
 *
 * ⚠️ This is the ONLY place an adapter is named. `vue/` imports the ready-made
 * use case from here — never the repository, never the use-case class — which
 * is why the lint boundaries can forbid `vue/ → infrastructure/` outright.
 *
 * No container, no DI framework, no `provide`/`inject`: plain module-level
 * singletons. Same shape in every `*.config.ts`.
 */
const tagRepository = new TagHttpRepository();

export const listTagsUseCase = new ListTagsUseCase(tagRepository);
