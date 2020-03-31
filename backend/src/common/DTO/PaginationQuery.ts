import { IsNumberString, IsOptional } from 'class-validator';

export class PaginationQuery {
  @IsNumberString()
  @IsOptional()
  limit: number;

  @IsNumberString()
  @IsOptional()
  page: number;
}
