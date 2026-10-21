import { ApiHideProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { toStringArray } from '../../../common/validation/to-string-array';

// ⚠️ **The order whitelist.** The client's string must never reach
// `addOrderBy(...)` directly: an ORDER BY fragment is not parameterised, so an
// arbitrary value would be an injection vector, reachable with a plain GET.
// These three values are the only ones the UI sends.
export const CLIP_ORDER_VALUES = ['points', 'clip.createdAt', 'episode.date'] as const;

export type ClipOrder = (typeof CLIP_ORDER_VALUES)[number];

// Sort applied when `order` is absent.
export const DEFAULT_CLIP_ORDER: ClipOrder = 'points';

export class ClipsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Sort key. Always descending, tie-broken by descending clip id.',
    enum: CLIP_ORDER_VALUES,
    default: DEFAULT_CLIP_ORDER,
  })
  @IsOptional()
  @IsIn([...CLIP_ORDER_VALUES])
  order?: ClipOrder;

  @ApiPropertyOptional({
    description:
      'Case- and accent-insensitive substring match over the clip title, its episode title and its tags.',
    maxLength: 255,
    example: 'canción',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({
    description:
      'Repeatable. A clip must carry EVERY tag listed (AND, not OR). Matched exactly: case- and accent-sensitive, unlike `search`.',
    type: [String],
    example: ['Absurdo'],
  })
  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  tags?: string[];

  // ⚠️ Not a typo and not dead code. Axios' default serialiser emits arrays as
  // `tags[]=a&tags[]=b`, which is the shape of every tag-filter link ever
  // shared, and express 5's default `simple` query parser hands that over under
  // the literal key `tags[]`. Without this property `whitelist` +
  // `forbidNonWhitelisted` would answer those URLs with a 400.
  //
  // Hidden from the OpenAPI document on purpose: the generated client should
  // send the canonical `tags`, which is also accepted. Use
  // `resolveRequestedTags()` rather than reading either field directly.
  @ApiHideProperty()
  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  'tags[]'?: string[];
}
