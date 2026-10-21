import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ example: 'ok' })
  status!: 'ok';

  @ApiProperty({ description: "The backend package's version", example: '2.0.0' })
  version!: string;

  @ApiProperty({ description: 'Server time, UTC ISO-8601', format: 'date-time' })
  time!: string;
}
