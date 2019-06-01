import { PaginationResultInterface } from './PaginationResultsInterface';

export class PaginationResults<PaginationEntity>
  implements PaginationResultInterface<PaginationEntity> {
  public results: PaginationEntity[];
  public total: number;

  constructor(paginationResults: PaginationResultInterface<PaginationEntity>) {
    this.results = paginationResults.results;
    this.total = paginationResults.total;
  }
}
