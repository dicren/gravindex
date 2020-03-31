export interface IPaginationResponse<PaginationEntity> {
  results: PaginationEntity[];
  total: number;
}
