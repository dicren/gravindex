import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { VALIDATION_PIPE_OPTIONS } from '../../../common/validation/validation-pipe.options';
import { EpisodeIdParamDto } from './episode-params.dto';
import { EpisodesQueryDto } from './episodes-query.dto';

// Runs the DTOs through exactly what the global `ValidationPipe` does — same
// transform options, same validator options — without a Nest app or a database.
function check<T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
): { dto: T; errors: string[] } {
  const dto = plainToInstance(cls, plain, VALIDATION_PIPE_OPTIONS.transformOptions);
  const errors = validateSync(dto, {
    whitelist: VALIDATION_PIPE_OPTIONS.whitelist,
    forbidNonWhitelisted: VALIDATION_PIPE_OPTIONS.forbidNonWhitelisted,
  }).map((error) => error.property);

  return { dto, errors };
}

const parse = (plain: Record<string, unknown>) => check(EpisodesQueryDto, plain);

describe('EpisodesQueryDto', () => {
  describe('pagination', () => {
    it('coerces the query string to numbers', () => {
      const { dto, errors } = parse({ page: '3', limit: '25' });

      expect(errors).toEqual([]);
      expect(dto.page).toBe(3);
      expect(dto.limit).toBe(25);
    });

    // ⚠️ A negative or NaN offset must never reach the query, so all three are a 400.
    it.each(['0', '-1', 'abc'])('rejects page %p', (page) => {
      expect(parse({ page }).errors).toEqual(['page']);
    });

    // ⚠️ `limit=0` would disable the LIMIT clause and return all 395 episodes,
    // and `limit=101`/`limit=99999` would exceed the cap: everything outside
    // 1–100 is a 400.
    it.each(['0', '101', '99999', '-5', 'abc'])('rejects limit %p', (limit) => {
      expect(parse({ limit }).errors).toEqual(['limit']);
    });

    it('accepts the largest limit the UI can ask for', () => {
      expect(parse({ limit: '100' }).errors).toEqual([]);
    });

    it('leaves both absent when they are not sent', () => {
      const { dto, errors } = parse({});

      expect(errors).toEqual([]);
      expect(dto.page).toBeUndefined();
      expect(dto.limit).toBeUndefined();
    });
  });

  describe('search', () => {
    it('accepts an accented term', () => {
      const { dto, errors } = parse({ search: 'Desnúdate' });

      expect(errors).toEqual([]);
      expect(dto.search).toBe('Desnúdate');
    });

    it('accepts an empty string, which the filter then treats as absent', () => {
      expect(parse({ search: '' }).errors).toEqual([]);
    });

    // ⚠️ A term past the column width is a 400, and so is `?search=a&search=b`,
    // which express hands over as an array.
    it('rejects a term past the column width', () => {
      expect(parse({ search: 'x'.repeat(256) }).errors).toEqual(['search']);
    });

    it('rejects a repeated search parameter, which arrives as an array', () => {
      expect(parse({ search: ['a', 'b'] }).errors).toEqual(['search']);
    });
  });

  describe('withClips', () => {
    it.each([
      ['true', true],
      ['false', false],
    ])('reads %p as %p', (raw, expected) => {
      const { dto, errors } = parse({ withClips: raw });

      expect(errors).toEqual([]);
      expect(dto.withClips).toBe(expected);
    });

    it('leaves it absent when it is not sent, which means "all of them"', () => {
      expect(parse({}).dto.withClips).toBeUndefined();
    });

    // ⚠️ **`Boolean('false')` is `true`**, which is exactly why the transform is
    // hand-rolled rather than `@Type(() => Boolean)`: implicit conversion would
    // turn "show everything" into "show only the 61 with clips". Anything that
    // is not one of the two honest spellings stays a string and fails.
    it.each(['1', '0', 'yes', 'no', 'TRUE', '', 'sí'])('rejects %p', (value) => {
      expect(parse({ withClips: value }).errors).toEqual(['withClips']);
    });
  });

  describe('unknown parameters', () => {
    // ⚠️ Undeclared parameters are a 400, never silently ignored. `order` in
    // particular: `/episodes` has no sort, and the UI never sends one.
    it.each(['zzz', 'order', 'tags', 'search[]'])('rejects %p', (key) => {
      expect(parse({ [key]: '1' }).errors).toEqual([key]);
    });
  });
});

describe('EpisodeIdParamDto', () => {
  it('coerces the path segment to a number', () => {
    const { dto, errors } = check(EpisodeIdParamDto, { id: '63' });

    expect(errors).toEqual([]);
    expect(dto.id).toBe(63);
  });

  // ⚠️ Each of these is a 400. An untyped param reaching `findOne({ where: { id } })`
  // would be cast silently instead of rejected.
  it.each(['abc', '0', '-1', '1.5', ''])('rejects id %p', (id) => {
    expect(check(EpisodeIdParamDto, { id }).errors).toEqual(['id']);
  });
});
