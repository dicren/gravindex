import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

/**
 * `PATCH /api/admin/clips/:id` — every field optional, because the real use is
 * fixing one thing: a title someone typed badly, or a cut that starts two
 * seconds late.
 *
 * ⚠️ `end > start` is NOT expressible here: a PATCH may send only one of the
 * two, so the rule needs the stored value of the other. `AdminService` checks it
 * against the merged result and answers 400.
 */
export class UpdateClipDto {
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  // `@IsNotEmpty()` would accept `'   '`. A clip whose title is three spaces is
  // an invisible row in the library.
  @Matches(/\S/, { message: 'title must not be blank' })
  title?: string;

  @ApiPropertyOptional({ description: 'Seconds from the start of the episode.', minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  start?: number;

  @ApiPropertyOptional({ description: 'Seconds from the start of the episode.', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  end?: number;
}
