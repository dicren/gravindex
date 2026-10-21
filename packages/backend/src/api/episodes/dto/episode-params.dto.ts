import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';
import { StrictInt } from '../../../common/validation/strict-int';

// ⚠️ An untyped `@Param() params: { id: number }` hands the string straight to
// the query, so `/episodes/abc`, `/episodes/0` and `/episodes/1.5` would reach
// the database and fail or match nothing. They are a **400**: a malformed id is
// a malformed request, not a missing episode.
//
// ⚠️ `@StrictInt()` rather than `@Type(() => Number)`, and for the same reason
// as the clip id: `Number('1e1')` is 10, so implicit conversion turned a
// malformed id into a perfectly valid one for a DIFFERENT episode. See
// `common/validation/strict-int.ts`.
export class EpisodeIdParamDto {
  @ApiProperty({
    description: 'Episode id. The frontend sends `<id>-<slug>` and parses the leading integer.',
    minimum: 1,
  })
  @StrictInt()
  @IsInt()
  @Min(1)
  id!: number;
}
