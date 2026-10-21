import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { DEFAULT_WAVEFORM_POINTS, MAX_WAVEFORM_POINTS } from '../../../waveform/waveform.constants';

// `GET /episodes/:id/waveform`'s query. `from`/`to`/`points` are ordinary
// QUERY parameters, so — unlike the id in the path — implicit conversion is
// fine here: see `common/validation/strict-int.ts` for why path parameters
// are the exception, not the rule.
export class EpisodeWaveformQueryDto {
  @ApiPropertyOptional({
    description: 'Seconds into the episode to start the slice at. Default 0.',
    minimum: 0,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  from?: number;

  @ApiPropertyOptional({
    description: 'Seconds into the episode to end the slice at. Default: the whole episode.',
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  to?: number;

  @ApiPropertyOptional({
    description: 'How many bytes to resample the slice down to.',
    minimum: 1,
    maximum: MAX_WAVEFORM_POINTS,
    default: DEFAULT_WAVEFORM_POINTS,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_WAVEFORM_POINTS)
  points?: number;
}

export function fromOf(query: EpisodeWaveformQueryDto): number {
  return query.from ?? 0;
}

export function pointsOf(query: EpisodeWaveformQueryDto): number {
  return query.points ?? DEFAULT_WAVEFORM_POINTS;
}
