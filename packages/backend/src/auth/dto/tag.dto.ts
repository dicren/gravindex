import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

/**
 * ⚠️ **The tag travels in a body or a query string, never in a path segment.**
 *
 * A tag is free text — the production data has 102 distinct ones, twelve of
 * them with accents or eñes, and nothing stops the next one containing a `/`,
 * a `?` or a `#`. `DELETE /admin/clips/7/tags/rock/roll` is not one route with
 * a funny parameter, it is a 404; percent-encoding it works but silently
 * depends on how the router treats `%2F`. A query parameter has none of that
 * ambiguity, and `encodeURIComponent` on the client is the whole contract.
 */
export class RenameTagDto {
  @ApiProperty({ maxLength: 255, description: 'The existing tag on this clip.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  tag!: string;

  @ApiProperty({ maxLength: 255, description: 'What it becomes.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/\S/, { message: 'newTag must not be blank' })
  newTag!: string;
}

/** `DELETE /api/admin/clips/:id/tags?tag=…` — see the note above. */
export class DeleteTagQueryDto {
  @ApiProperty({ maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  tag!: string;
}
