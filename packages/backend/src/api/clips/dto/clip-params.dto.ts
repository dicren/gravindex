import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';
import { StrictInt } from '../../../common/validation/strict-int';

// Route parameters, validated rather than `parseInt`-ed inside the handler.
// Parsing an untyped `@Param() params` by hand is how `GET /clips/abc` would
// reach the database as `NaN`; here a non-numeric id is a 400 instead.
//
// ⚠️ `@StrictInt()` rather than `@Type(() => Number)`: the id in the path is a
// public URL and must resolve to one clip and only one. See
// `common/validation/strict-int.ts` for what `Number()` accepted that it should
// not have.
export class ClipIdParamDto {
  @ApiProperty({ description: 'Clip id.', minimum: 1 })
  @StrictInt()
  @IsInt()
  @Min(1)
  id!: number;
}

// ⚠️ **One value, and `-1` is not one of them**. Every screen has a single
// thumb-up, so a positive vote is the only thing there is to record.
//
// The path keeps its `/:value` segment rather than becoming `/vote`, because
// clients call that shape: one that sends `-1` must be told (400) rather than
// have it silently counted as an upvote.
export const VOTE_VALUES = [1] as const;

export class VoteParamsDto extends ClipIdParamDto {
  // ⚠️ `value` is +1, and the whole points model assumes it. A parser that
  // accepts anything would let `/vote/5` store a vote worth five points and
  // `/vote/abc` store NaN.
  //
  // Strict for the same reason the id is: `/vote/0x1` is not a spelling of 1
  // that any client emits, and reading it as one is how a value nobody wrote
  // ends up in the table.
  @ApiProperty({
    description: 'The vote. Always 1: an upvote is the only vote there is.',
    enum: VOTE_VALUES,
  })
  @StrictInt()
  @IsInt()
  @IsIn([...VOTE_VALUES])
  value!: number;
}

export class TagParamsDto extends ClipIdParamDto {
  @ApiProperty({ description: 'The tag to attach, as free text.', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  value!: string;
}
