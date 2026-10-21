import { ApiProperty } from '@nestjs/swagger';

// The `{ results, total }` envelope. It is a **frontend contract**: the list
// views read `total` to know how many rows there are, so it is always the number
// matching the filters IGNORING pagination — including when the requested page
// is past the end and `results` is empty.
export interface PaginatedResult<T> {
  results: T[];
  total: number;
}

// Extend this and re-declare `results` with a concrete `@ApiProperty({ type: () => [X] })`.
// A generic `PaginatedResponseDto<Clip>` cannot be expressed in OpenAPI without
// `@ApiExtraModels` + `getSchemaPath` gymnastics that produce anonymous
// `allOf` schemas — and the frontend's client is GENERATED from this document,
// so a named `ClipListResponseDto` is worth the one extra line per module.
export abstract class PaginatedResponseDto<T> implements PaginatedResult<T> {
  abstract results: T[];

  @ApiProperty({
    description: 'Rows matching the query, ignoring pagination.',
    example: 180,
  })
  total!: number;
}
