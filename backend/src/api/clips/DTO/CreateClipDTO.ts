import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class CreateClipDTO {
  @IsInt()
  @Min(0)
  start: number;

  @IsInt()
  @Min(0)
  end: number;

  @IsNotEmpty()
  tags: string[];

  @IsInt()
  episode: number;

  @IsString()
  title: string;
}
