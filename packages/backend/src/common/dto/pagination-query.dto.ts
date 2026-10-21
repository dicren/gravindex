import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// The pagination half of every list query in this API. `GET /clips` and
// `GET /episodes` both take exactly these two parameters, so they live here and
// are EXTENDED, never re-declared: a subclass that restated `limit` or `page`
// without their validators would silently escape them.

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 10;

// ⚠️ There is an upper bound: `?limit=99999` would return every row, and
// `?limit=0` would disable the LIMIT clause entirely. 100 is not arbitrary — it
// is the largest value the UI's page-size selector offers, so no reachable
// screen loses anything.
export const MAX_LIMIT = 100;

export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: '1-based page number.',
    minimum: 1,
    default: DEFAULT_PAGE,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Rows per page.',
    minimum: 1,
    maximum: MAX_LIMIT,
    default: DEFAULT_LIMIT,
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number;
}

export function limitOf(query: PaginationQueryDto): number {
  return query.limit ?? DEFAULT_LIMIT;
}

export function pageOf(query: PaginationQueryDto): number {
  return query.page ?? DEFAULT_PAGE;
}

export function offsetOf(query: PaginationQueryDto): number {
  return (pageOf(query) - 1) * limitOf(query);
}
