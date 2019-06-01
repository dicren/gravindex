import { QueryOptions } from './QueryOptions';

export class OptionBuilder {
  static pagination(options: QueryOptions) {
    return {
      take: options.limit,
      skip: (options.page - 1) * options.limit,
    };
  }
}
