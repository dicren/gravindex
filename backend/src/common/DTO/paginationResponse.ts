import { IPaginationResponse } from './IPaginationResponse';

export class PaginationResponse<PaginationEntity>
  implements IPaginationResponse<PaginationEntity> {
  public results: PaginationEntity[];
  public total: number;

  constructor(paginationResults: IPaginationResponse<PaginationEntity>) {
    this.results = paginationResults.results;
    this.total = paginationResults.total;
  }
}
