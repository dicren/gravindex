import { PaginationQuery } from '../DTO/PaginationQuery';

export class Pagination {
  static pagination(options: PaginationQuery) {
    return {
      take: options.limit,
      skip: (options.page - 1) * options.limit,
    };
  }
  public static getLimit(q: PaginationQuery) {
    return q.limit || 10;
  }

  public static getOffset(q: PaginationQuery) {
    return ((q.page || 1) - 1) * (q.limit || 10);
  }

  public static getTake(q: PaginationQuery) {
    return Pagination.getLimit(q);
  }

  public static getSkip(q: PaginationQuery) {
    return Pagination.getOffset(q);
  }
}
