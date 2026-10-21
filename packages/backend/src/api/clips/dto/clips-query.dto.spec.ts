import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { VALIDATION_PIPE_OPTIONS } from '../../../common/validation/validation-pipe.options';
import { ClipsQueryDto } from './clips-query.dto';
import { resolveRequestedTags } from '../clips.sql';

// Runs the DTO through exactly what the global `ValidationPipe` does — same
// transform options, same validator options — without a Nest app or a database.
function parse(query: Record<string, unknown>): { dto: ClipsQueryDto; errors: string[] } {
  const dto = plainToInstance(ClipsQueryDto, query, VALIDATION_PIPE_OPTIONS.transformOptions);
  const errors = validateSync(dto, {
    whitelist: VALIDATION_PIPE_OPTIONS.whitelist,
    forbidNonWhitelisted: VALIDATION_PIPE_OPTIONS.forbidNonWhitelisted,
  }).map((error) => error.property);

  return { dto, errors };
}

describe('ClipsQueryDto', () => {
  describe('pagination', () => {
    it('coerces the query string to numbers', () => {
      const { dto, errors } = parse({ page: '3', limit: '25' });

      expect(errors).toEqual([]);
      expect(dto.page).toBe(3);
      expect(dto.limit).toBe(25);
    });

    it('rejects page 0 and negative pages', () => {
      expect(parse({ page: '0' }).errors).toEqual(['page']);
      expect(parse({ page: '-1' }).errors).toEqual(['page']);
    });

    // ⚠️ `?limit=0` would disable the LIMIT clause and `?limit=99999` would
    // return every row: both must be a 400.
    it('rejects limit 0 and limits past the cap', () => {
      expect(parse({ limit: '0' }).errors).toEqual(['limit']);
      expect(parse({ limit: '101' }).errors).toEqual(['limit']);
      expect(parse({ limit: '100' }).errors).toEqual([]);
    });

    it('rejects a non-numeric page', () => {
      expect(parse({ page: 'abc' }).errors).toEqual(['page']);
    });

    it('leaves both absent when they are not sent', () => {
      const { dto, errors } = parse({});

      expect(errors).toEqual([]);
      expect(dto.page).toBeUndefined();
      expect(dto.limit).toBeUndefined();
    });
  });

  describe('order', () => {
    it.each(['points', 'clip.createdAt', 'episode.date'])('accepts %s', (order) => {
      expect(parse({ order }).errors).toEqual([]);
    });

    // The injection vector, closed. `clip.id` is a real column, so only the
    // whitelist keeps it out of the ORDER BY; `bogus` must be a 400, not a 500.
    it.each(['clip.id', 'bogus', 'clip.id; drop table clip', '1'])('rejects %s', (order) => {
      expect(parse({ order }).errors).toEqual(['order']);
    });
  });

  describe('tags', () => {
    it('accepts the canonical repeated `tags`', () => {
      const { dto, errors } = parse({ tags: ['Absurdo', 'Canción'] });

      expect(errors).toEqual([]);
      expect(resolveRequestedTags(dto)).toEqual(['Absurdo', 'Canción']);
    });

    // The wire format every existing link uses (axios' array serialiser +
    // express 5's `simple` query parser).
    it('accepts the axios `tags[]` wire format', () => {
      const { dto, errors } = parse({ 'tags[]': ['Absurdo', 'Canción'] });

      expect(errors).toEqual([]);
      expect(resolveRequestedTags(dto)).toEqual(['Absurdo', 'Canción']);
    });

    // A single occurrence arrives as a bare string under either key. It must be
    // wrapped, or the filter would run on its characters ('A') and match nothing.
    it.each(['tags', 'tags[]'])('wraps a single %s value in an array', (key) => {
      const { dto, errors } = parse({ [key]: 'Absurdo' });

      expect(errors).toEqual([]);
      expect(resolveRequestedTags(dto)).toEqual(['Absurdo']);
    });

    it('de-duplicates and merges both spellings', () => {
      const { dto } = parse({ tags: ['Absurdo'], 'tags[]': ['Absurdo', 'Canción'] });

      expect(resolveRequestedTags(dto)).toEqual(['Absurdo', 'Canción']);
    });

    it('is an empty list when absent', () => {
      expect(resolveRequestedTags(parse({}).dto)).toEqual([]);
    });

    it('rejects a tag past the column width', () => {
      expect(parse({ tags: ['x'.repeat(256)] }).errors).toEqual(['tags']);
    });
  });

  describe('unknown parameters', () => {
    // ⚠️ Undeclared parameters are a 400, never silently ignored.
    it('rejects an undeclared query parameter', () => {
      expect(parse({ zzz: '1' }).errors).toEqual(['zzz']);
    });
  });
});
