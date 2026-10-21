import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { VALIDATION_PIPE_OPTIONS } from '../../../common/validation/validation-pipe.options';
import { ClipIdParamDto, TagParamsDto, VoteParamsDto } from './clip-params.dto';
import { CreateClipDto } from './create-clip.dto';

// ⚠️ Every rule below is enforced by the global `ValidationPipe`, so
// each of these cases is rejected with a 400 instead of being stored or failing
// later.

function errorsOf<T extends object>(cls: new () => T, plain: Record<string, unknown>): string[] {
  const dto = plainToInstance(cls, plain, VALIDATION_PIPE_OPTIONS.transformOptions);

  return validateSync(dto, {
    whitelist: VALIDATION_PIPE_OPTIONS.whitelist,
    forbidNonWhitelisted: VALIDATION_PIPE_OPTIONS.forbidNonWhitelisted,
  }).map((error) => error.property);
}

const valid = { start: 10, end: 20, title: 'Un clip', tags: ['Absurdo'], episode: 1 };

describe('CreateClipDto', () => {
  it('accepts a well-formed clip', () => {
    expect(errorsOf(CreateClipDto, valid)).toEqual([]);
  });

  it('accepts an empty tag list — 8 of the 180 production clips have none', () => {
    expect(errorsOf(CreateClipDto, { ...valid, tags: [] })).toEqual([]);
  });

  it.each([
    ['end equal to start', { end: 10, start: 10 }],
    ['end before start', { end: 5, start: 10 }],
  ])('rejects %s', (_label, override) => {
    expect(errorsOf(CreateClipDto, { ...valid, ...override })).toEqual(['end']);
  });

  it('rejects fractional offsets', () => {
    expect(errorsOf(CreateClipDto, { ...valid, start: 1.5 })).toEqual(['start']);
  });

  it('rejects a negative start', () => {
    expect(errorsOf(CreateClipDto, { ...valid, start: -1 })).toEqual(['start']);
  });

  it('rejects an empty title', () => {
    expect(errorsOf(CreateClipDto, { ...valid, title: '' })).toEqual(['title']);
  });

  // ⚠️ A DECISION, not an oversight: the title is stored exactly as submitted,
  // so a whitespace-only one gets through. Trimming would change what lands in
  // the column, and that is a behaviour change which needs its own recorded
  // decision.
  it('accepts a whitespace-only title, because nothing trims it', () => {
    expect(errorsOf(CreateClipDto, { ...valid, title: ' \t ' })).toEqual([]);
  });

  it('rejects a title past the varchar(255) column width', () => {
    expect(errorsOf(CreateClipDto, { ...valid, title: 'x'.repeat(256) })).toEqual(['title']);
  });

  it('rejects a missing tag list rather than crashing in the loop', () => {
    const { tags: _tags, ...withoutTags } = valid;

    expect(errorsOf(CreateClipDto, withoutTags)).toEqual(['tags']);
  });

  it('rejects an empty tag string and an over-long one', () => {
    expect(errorsOf(CreateClipDto, { ...valid, tags: [''] })).toEqual(['tags']);
    expect(errorsOf(CreateClipDto, { ...valid, tags: ['x'.repeat(256)] })).toEqual(['tags']);
  });

  it('rejects an undeclared body property', () => {
    expect(errorsOf(CreateClipDto, { ...valid, ip: '203.0.113.1' })).toEqual(['ip']);
  });
});

describe('route parameters', () => {
  it('coerces a numeric id', () => {
    expect(errorsOf(ClipIdParamDto, { id: '178' })).toEqual([]);
  });

  it.each(['abc', '0', '-3', '1.5'])('rejects id %p', (id) => {
    expect(errorsOf(ClipIdParamDto, { id })).toEqual(['id']);
  });

  it('accepts vote value 1, the only one there is', () => {
    expect(errorsOf(VoteParamsDto, { id: '1', value: '1' })).toEqual([]);
  });

  // ⚠️ Only `1` is a vote: `/vote/5` must not store five points, `/vote/abc`
  // must not become NaN, and `-1` is not a value this API accepts.
  it.each(['5', '0', '-1', '-2', 'abc'])('rejects vote value %p', (value) => {
    expect(errorsOf(VoteParamsDto, { id: '1', value })).toEqual(['value']);
  });

  it('rejects a tag past the column width', () => {
    expect(errorsOf(TagParamsDto, { id: '1', value: 'x'.repeat(256) })).toEqual(['value']);
  });
});
