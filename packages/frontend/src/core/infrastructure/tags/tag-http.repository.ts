import type { TagCount } from '#/domain/tags/tag.entity';
import type { TagRepository } from '#/domain/tags/tag.repository';
import { tagsControllerList } from '#/infrastructure/generated';
import { assertResponseOk, translateHttpError } from '#/infrastructure/http/translate-http-error';
import { tagListResponseSchema } from './tag.dto';

/**
 * ⚠️ The template every HTTP adapter copies.
 *
 * Note what is NOT here: a URL. `tagsControllerList` comes from
 * `infrastructure/generated/`, produced from `packages/backend/openapi.json` by
 * `npm run generate:api`. No endpoint string is written by hand anywhere in
 * this package.
 *
 * The four steps, in order, are the pattern: call the generated operation →
 * reject a non-2xx status → parse the payload with the feature's narrow schema
 * → map the DTO to domain entities. For a feature whose DTO and entity differ
 * (clips, episodes) that last step belongs in a sibling `tag.mapper.ts`-style
 * file; here the wire shape and the entity are the same two fields, so there is
 * nothing to map and inventing an identity mapper would be ceremony.
 */
export class TagHttpRepository implements TagRepository {
  async listAll(signal?: AbortSignal): Promise<TagCount[]> {
    try {
      const { data, error: failure, response } = await tagsControllerList({ signal });
      assertResponseOk(response, failure);
      return tagListResponseSchema.parse(data);
    } catch (error) {
      throw translateHttpError(error, signal);
    }
  }
}
