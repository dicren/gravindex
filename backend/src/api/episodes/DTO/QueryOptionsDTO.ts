import { PaginationQuery } from '../../../queryOptions/PaginationQuery';

export class QueryOptionsDTO implements PaginationQuery {
  limit: number;
  page: number;
  search: string;
}
