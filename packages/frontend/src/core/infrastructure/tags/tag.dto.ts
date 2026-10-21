import { z } from 'zod';

/**
 * ⚠️ Deliberately NARROW, and hand-written rather than generated.
 *
 * The generated types mirror the OpenAPI document exactly, including fields
 * this feature does not read and `required` flags that Nest's decorators
 * overstate. Validating against a schema of only what we consume means a
 * backend adding a field never breaks the client, while a backend changing
 * something we *do* read fails loudly, here, instead of surfacing as
 * `undefined` three layers up.
 */
/**
 * ⚠️ **`{ tag, count }`, not a bare string.** `GET /tags` answered a flat
 * `string[]` against this fails loudly here rather than rendering 102 empty
 * rows.
 */
export const tagCountSchema = z.object({ tag: z.string(), count: z.number() });

export const tagListResponseSchema = z.array(tagCountSchema);
