import { PaginationQuery } from './PaginationQuery';

export class OptionBuilder {
  static pagination(options: PaginationQuery) {
    return {
      take: options.limit,
      skip: (options.page - 1) * options.limit,
    };
  }
}
