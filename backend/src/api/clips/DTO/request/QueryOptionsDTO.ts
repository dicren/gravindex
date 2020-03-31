import { PaginationQuery } from '../../../../common/DTO/PaginationQuery';

export class QueryOptionsDTO implements PaginationQuery {
  limit: number;
  page: number;
  order: string;
  search: string;
  tags: string[];
}
