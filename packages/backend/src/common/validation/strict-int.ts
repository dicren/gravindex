import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { Transform, TransformFnParams } from 'class-transformer';

// ⚠️ **Why numeric path parameters are not left to implicit conversion.**
//
// The global pipe runs with `transformOptions: { enableImplicitConversion:
// true }`, which coerces a `number`-typed property with `Number()`. `Number()`
// understands rather more than a URL path segment ever should:
//
//   Number('1e1')  === 10      Number('0x2')  === 2      Number('1.5') === 1.5
//
// so the value was already a valid, in-range integer by the time `@IsInt()`
// and `@Min(1)` looked at it, and `GET /clips/1e1` served **clip ten**. The
// `parseInt(value, 10)` disagrees on exactly those spellings (it reads `1e1` as
// 1 and `0x2` as 0), so the same URL would mean different ids depending on the
// parser.
//
// This closes the hole rather than picking one side of it. A malformed id is a
// **400**, not a 404 and not a coerced hit, for `/clips/abc`, `/clips/0` and
// `/clips/1.5`; `1e1` and `0x2` are the same case, not a new exception.
//
// ⚠️ What still has to be accepted, because it always was and real requests
// contain it: surrounding whitespace (`/clips/%201`), a leading `+`
// (`/clips/%2B1`) and leading zeroes (`/clips/01`). All three resolve to the
// same clip as their plain form.
//
// Scope: **path parameters only.** `page` and `limit` keep the implicit
// conversion — they are query parameters with their own bounds, and every
// out-of-range or non-numeric spelling of them is already a 400 through
// `@IsInt()` / `@Min()` / `@Max()`.
const STRICT_DECIMAL_INTEGER = /^[+-]?\d+$/;

/**
 * A decimal integer, or `NaN` for everything else.
 *
 * `NaN` rather than a thrown error on purpose: this feeds a `class-validator`
 * property, and letting `@IsInt()` be the thing that rejects keeps the 400's
 * body identical in shape to every other validation failure.
 */
export function parseStrictInt(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value !== 'string') {
    return Number.NaN;
  }

  const trimmed = value.trim();

  return STRICT_DECIMAL_INTEGER.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/**
 * Property decorator for a numeric route parameter. Pair it with `@IsInt()` and
 * whatever bound the parameter has, and use it **instead of**
 * `@Type(() => Number)`.
 *
 * ⚠️ **It reads `obj[key]`, not `value`, and that is not an optimisation.** In
 * class-transformer 0.5 a `@Transform` on a `plainToInstance` runs AFTER the
 * implicit conversion, so `value` is already `Number('1e1') === 10` and the
 * evidence that the request said `1e1` is gone by then. `obj` is the untouched
 * source object — the only place the raw path segment still exists.
 */
export const StrictInt = (): PropertyDecorator =>
  Transform(({ obj, key }: TransformFnParams): number | undefined => {
    const source: unknown = obj;
    const raw =
      typeof source === 'object' && source !== null
        ? (source as Record<string, unknown>)[key]
        : undefined;

    // Left absent rather than turned into `NaN`, so the decorator composes with
    // `@IsOptional()`. Nothing uses it that way today; every path parameter is
    // required and always present.
    return raw === undefined || raw === null ? undefined : parseStrictInt(raw);
  });

/**
 * The same rule as a pipe, for handlers that take `@Param('id', …)` rather than
 * a DTO. A drop-in for Nest's `ParseIntPipe`, which accepts anything
 * `parseFloat` and `Number` both like and then runs `parseInt` over it — so it
 * reads `1e1` as 1, `1.5` as 1 and `0x2` as 0, silently.
 */
@Injectable()
export class StrictIntPipe implements PipeTransform<unknown, number> {
  transform(value: unknown): number {
    const parsed = parseStrictInt(value);

    if (!Number.isInteger(parsed)) {
      throw new BadRequestException('Validation failed (a decimal integer is expected)');
    }

    return parsed;
  }
}
