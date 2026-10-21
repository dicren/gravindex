import { ApiProperty } from '@nestjs/swagger';

// One row of `GET /tags`.
//
// ⚠️ A tag IS the `(clip, tag)` pair — there is no tag table, no id and no
// rename outside the admin surface — so this object is a grouping, not an
// entity. `tag` is the identity: it is what `GET /clips?tags[]=` matches, byte
// for byte.
//
// ⚠️ **All 102 existing tags begin with a space** (` Canciones`, ` Cine`).
// Shared `?tags[]=` links carry that space, so nothing here trims:
// display-time trimming is the frontend's job and the stored form is the only
// one that matches anything.
export class TagCountDto {
  @ApiProperty({ description: 'The tag, exactly as stored.', example: ' Canciones' })
  tag!: string;

  @ApiProperty({ description: 'How many clips carry it.', example: 19 })
  count!: number;
}
