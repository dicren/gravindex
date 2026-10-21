import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { StrictIntPipe } from '../../../common/validation/strict-int';
import { VALIDATION_PIPE_OPTIONS } from '../../../common/validation/validation-pipe.options';
import { EpisodeIdParamDto } from '../../episodes/dto/episode-params.dto';
import { ClipIdParamDto, TagParamsDto, VoteParamsDto } from './clip-params.dto';

// ⚠️ **Regression suite for numeric path parameters.**
//
// The global pipe runs with `enableImplicitConversion`, which coerces with
// `Number()`. `Number('1e1')` is 10 and `Number('0x2')` is 2, so `GET
// /clips/1e1` served clip TEN and `GET /clips/0x2` served clip 2 — one URL,
// two documents, depending on which backend answered. Everything below runs
// the DTO through EXACTLY the options `main.ts` registers, so a change to those
// options that reopens the hole fails here rather than in production.

function parse<T extends object>(
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

// Every spelling that is NOT a plain decimal integer. `1e1` and `0x2` are the
// two that `Number()` would silently read as numbers; the rest are the same
// family. They are all listed so that a "simplification" of the rule that loses
// one of them is loud.
const REJECTED_IDS = [
  '1e1',
  '1E1',
  '0x2',
  '0X2',
  '0b11',
  '0o7',
  '1.5',
  '1.0',
  '.5',
  '1_0',
  'abc',
  'Infinity',
  '1e400',
  '',
  ' ',
  '\t',
  '1 2',
  'null',
  '[]',
];

// ⚠️ Accepted, and they must stay accepted: all three are spellings a real
// request contains, and each resolves to the same row as its plain form.
//   '01'    leading zero
//   '+1'    the decoded form of `%2B1`
//   ' 1'    the decoded form of `%201`
const ACCEPTED_IDS: [string, number][] = [
  ['1', 1],
  ['01', 1],
  ['+1', 1],
  [' 1', 1],
  ['1 ', 1],
  ['182', 182],
  ['0000000012', 12],
];

describe.each([
  ['ClipIdParamDto', ClipIdParamDto],
  ['EpisodeIdParamDto', EpisodeIdParamDto],
] as const)('%s.id', (_name, cls) => {
  it.each(REJECTED_IDS)('rejects %p instead of coercing it', (id) => {
    expect(parse(cls, { id }).errors).toEqual(['id']);
  });

  it.each(ACCEPTED_IDS)('accepts %p as %i', (id, expected) => {
    const { dto, errors } = parse(cls, { id });

    expect(errors).toEqual([]);
    expect(dto.id).toBe(expected);
  });

  // Out of range rather than malformed, and still a 400: the id never reaches
  // the database.
  it.each(['0', '-1', '+0', '-0'])('rejects %p as out of range', (id) => {
    expect(parse(cls, { id }).errors).toEqual(['id']);
  });

  // The two clips deleted by hand in 2019. Their ids are public URLs that must
  // keep 404-ing, which means the DTO has to let them through to the service.
  it.each(['175', '176'])('lets the deleted id %p reach the service, so it can 404', (id) => {
    expect(parse(cls, { id }).errors).toEqual([]);
  });
});

describe('VoteParamsDto.value', () => {
  it.each(['1', '+1', '01', ' 1'])('accepts %p', (value) => {
    expect(parse(VoteParamsDto, { id: '1', value }).errors).toEqual([]);
  });

  // ⚠️ `1e0` IS the number one, but it is not a spelling any client emits, and
  // accepting it is the same hole that would let `/clips/1e1` serve the wrong
  // clip. Same rule everywhere beats a rule with one numeric exception in it.
  it.each(['1e0', '0x1', '1.0', '-1e0', 'abc', ''])('rejects %p', (value) => {
    expect(parse(VoteParamsDto, { id: '1', value }).errors).toEqual(['value']);
  });

  // ⚠️ **`-1` is a 400.** A client sending one has to be TOLD — silently
  // storing it as an upvote would corrupt the counts it is about to read back,
  // and silently answering 201 with nothing stored would look like it worked.
  it.each(['-1', '-01', ' -1'])('rejects a negative vote %p', (value) => {
    expect(parse(VoteParamsDto, { id: '1', value }).errors).toEqual(['value']);
  });

  it.each(['0', '2', '-2', '5', '100'])('rejects %p: only +1 exists', (value) => {
    expect(parse(VoteParamsDto, { id: '1', value }).errors).toEqual(['value']);
  });

  it('rejects the id and the value independently', () => {
    expect(parse(VoteParamsDto, { id: '0x2', value: '1' }).errors).toEqual(['id']);
  });
});

describe('TagParamsDto.value', () => {
  // ⚠️ The tag is free text and must NOT be touched by any of this: `1e1` is a
  // perfectly good tag.
  it.each(['1e1', '0x2', 'Cine', 'Monográficos'])('keeps %p as the string it is', (value) => {
    const { dto, errors } = parse(TagParamsDto, { id: '1', value });

    expect(errors).toEqual([]);
    expect(dto.value).toBe(value);
  });
});

// The pipe form, used by the admin routes, has to answer the same way — it
// replaced Nest's `ParseIntPipe`, which reads `1e1` as 1 and `0x2` as 0.
describe('StrictIntPipe', () => {
  const pipe = new StrictIntPipe();

  it.each(ACCEPTED_IDS)('accepts %p as %i', (value, expected) => {
    expect(pipe.transform(value)).toBe(expected);
  });

  it.each(REJECTED_IDS)('throws a 400 for %p', (value) => {
    expect(() => pipe.transform(value)).toThrow(BadRequestException);
  });

  // `@Min(1)` is the DTO's job, not the pipe's: the admin routes answer 404 for
  // an id that does not exist, and 0 is simply one of those.
  it('leaves range checks to the handler', () => {
    expect(pipe.transform('0')).toBe(0);
    expect(pipe.transform('-1')).toBe(-1);
  });
});
