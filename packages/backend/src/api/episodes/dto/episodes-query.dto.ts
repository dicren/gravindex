import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { StrictBoolean } from '../../../common/validation/strict-boolean';

// ⚠️ `page` and `limit` are INHERITED, never re-declared: a re-declared bare
// field would escape the validation on the base class — see
// `common/dto/pagination-query.dto.ts`.
export class EpisodesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Case- and accent-insensitive substring match over the episode TITLE only. ⚠️ Narrower ' +
      'than `GET /clips`, which also searches the episode title and the tags — that asymmetry ' +
      'is deliberate.',
    maxLength: 255,
    example: 'Desnúdate',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  // The `Todos · 395` / `Solo con cortes · 61` toggle on the episode list.
  // Only 61 of the 395 episodes have ever had a
  // clip cut from them, which is the fact the screen exists to make visible;
  // this is the control that acts on it.
  //
  // ⚠️ `@StrictBoolean()` rather than `@Type(() => Boolean)`, and for exactly
  // the reason `StrictInt` exists on the ids: `Boolean('false')` is `true`, so
  // implicit conversion would turn "show everything" into "show only the ones
  // with clips" — the opposite of what was asked, with no validator able to
  // notice. See `common/validation/strict-boolean.ts`.
  @ApiPropertyOptional({
    description: 'When true, only episodes that have at least one clip. `true` / `false` only.',
    type: Boolean,
    example: true,
  })
  @IsOptional()
  @StrictBoolean()
  @IsBoolean()
  withClips?: boolean;
}
