import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { IsGreaterThan } from '../../../common/validation/is-greater-than.validator';

// ⚠️ These decorators are enforced by the global `ValidationPipe`
// registered in `main.ts`. Requests that break a rule get a 400, so unplayable
// clips are never stored. The rules that the pipe alone cannot express —
// `end > start`, a non-empty title, a bounded title length — are declared here.
export class CreateClipDto {
  @ApiProperty({ description: 'Offset into the episode, in whole seconds.', minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  start!: number;

  @ApiProperty({
    description: 'Offset into the episode, in whole seconds. Must be greater than `start`.',
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  // A clip whose end is at or before its start is unplayable: the player seeks
  // to `start` and stops at `end`. Nothing checked this before.
  @IsGreaterThan('start')
  end!: number;

  @ApiProperty({ maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

  @ApiProperty({
    description: 'Free-text tags. May be empty; duplicates are collapsed.',
    type: [String],
  })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(255, { each: true })
  tags!: string[];

  @ApiProperty({ description: 'Id of the episode this clip is cut from.', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  episode!: number;
}
