import { Transform, TransformFnParams } from 'class-transformer';

// ⚠️ **Why a boolean query parameter is not left to implicit conversion.**
//
// The global pipe runs with `transformOptions: { enableImplicitConversion:
// true }`, which coerces a `boolean`-typed property with `Boolean()`. And
// `Boolean()` is true for every non-empty string there is:
//
//   Boolean('false') === true      Boolean('0') === true      Boolean('no') === true
//
// so `?withClips=false` — the spelling a client naturally sends to turn a
// toggle OFF — arrives as `true` and the filter does the opposite of what was
// asked. There is no validator that can catch it either: by the time
// `@IsBoolean()` looks, the value is a perfectly good boolean.
//
// This is `StrictInt`'s problem with a different primitive, and it has the same
// two halves: read the RAW value, and accept only the spellings a query string
// can honestly carry.
//
// ⚠️ Only `'true'` and `'false'`, lowercase. `1`/`0`/`yes`/`sí` are not accepted
// and should not be: nothing in this project emits them, the OpenAPI document
// says `boolean`, and a lenient list is how `?withClips=0` ends up meaning
// "only the ones with clips". Anything else is left untouched so `@IsBoolean()`
// answers 400 — the same shape as every other validation failure.

/** `'true'` / `'false'` (and real booleans) → boolean. Everything else, verbatim. */
export function parseStrictBoolean(value: unknown): unknown {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;

  return value;
}

/**
 * Property decorator for a boolean query parameter. Pair it with
 * `@IsBoolean()`, and use it **instead of** `@Type(() => Boolean)`.
 *
 * ⚠️ **It reads `obj[key]`, not `value`.** In class-transformer 0.5 a
 * `@Transform` on a `plainToInstance` runs AFTER the implicit conversion, so
 * `value` is already `Boolean('false') === true` and the evidence that the
 * request said `false` is gone by then. `obj` is the untouched source object —
 * the only place the raw query string still exists. (Same reasoning, same
 * discovery, as `StrictInt`.)
 */
export const StrictBoolean = (): PropertyDecorator =>
  Transform(({ obj, key }: TransformFnParams): unknown => {
    const source: unknown = obj;
    const raw =
      typeof source === 'object' && source !== null
        ? (source as Record<string, unknown>)[key]
        : undefined;

    // Left absent rather than coerced, so the decorator composes with
    // `@IsOptional()` — which every boolean query parameter needs.
    return raw === undefined || raw === null ? undefined : parseStrictBoolean(raw);
  });
