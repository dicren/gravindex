import { ApiProperty } from '@nestjs/swagger';
import { PaginatedResponseDto } from '../../../common/dto/paginated-response.dto';

// The episode as it rides along inside a clip. ⚠️ `description` is absent on
// purpose — it is `lazy` in the schema and has never been surfaced in the UI.
export class ClipEpisodeDto {
  @ApiProperty({ example: 63 })
  id!: number;

  @ApiProperty({ example: 'Episodio 86 (Spanish Zombies)' })
  title!: string;

  @ApiProperty({ description: 'Cover image URL.' })
  cover!: string;

  @ApiProperty({ description: 'The remote mp3 the browser streams. Not hosted here.' })
  file!: string;

  @ApiProperty({ description: "The episode's page on gravina82.com." })
  originalUrl!: string;

  @ApiProperty({ description: 'Publish date, UTC ISO-8601.', format: 'date-time', type: String })
  date!: string;
}

// A tag IS the `(clip, tag)` pair — there is no tag table, no id, no rename.
export class ClipTagDto {
  @ApiProperty({ description: 'Owning clip id.', example: 178 })
  clipId!: number;

  @ApiProperty({ description: 'Free text, as submitted.', example: 'Mulata' })
  tag!: string;
}

// `GET /clips/:id` and the body of `POST /clips`.
//
// ⚠️ **`up` is aggregated at read time.** The clip permalink and the global
// player draw a vote count for a clip opened by URL, and there is no other
// source for it, so the field is always present.
//
// ⚠️ No `down` (`clip-params.dto.ts`) and no `points` — with a single positive
// vote, `points` would be a second name for `up`, and `GET /clips` only keeps it
// because `order=points` travels in links people have shared.
//
// On `POST /clips` it is `0`, which is not a placeholder: a clip published a
// second ago genuinely has no votes.
export class ClipDto {
  @ApiProperty({
    description: 'THE public identifier: `https://indice.gravina82.com/<id>` is the permalink.',
    example: 178,
  })
  id!: number;

  @ApiProperty({ example: 'La mulata del clítor...' })
  title!: string;

  @ApiProperty({ description: 'Offset into the episode, in whole seconds.', example: 792 })
  start!: number;

  @ApiProperty({ description: 'Offset into the episode, in whole seconds.', example: 870 })
  end!: number;

  @ApiProperty({ type: () => ClipEpisodeDto })
  episode!: ClipEpisodeDto;

  @ApiProperty({ type: () => [ClipTagDto] })
  tags!: ClipTagDto[];

  @ApiProperty({
    description: 'Number of upvotes. Not a column — aggregated per request.',
    example: 15,
  })
  up!: number;
}

// A row of `GET /clips`, which additionally carries the sort key.
export class ClipListItemDto extends ClipDto {
  // ⚠️ Equal to `up`, always, since a vote can only be +1. It survives as its
  // own field for one reason: `order=points` is the default sort and it travels
  // in every library link ever shared, so the name has to keep meaning
  // something. Renaming it would break those URLs; dropping it would make the
  // rows disagree with the control that sorted them.
  @ApiProperty({
    description: 'The sort key. Identical to `up`: every vote is positive.',
    example: 15,
  })
  points!: number;
}

export class ClipListResponseDto extends PaginatedResponseDto<ClipListItemDto> {
  @ApiProperty({ type: () => [ClipListItemDto] })
  results!: ClipListItemDto[];
}

// ⚠️ **A repeated vote is NOT an HTTP error.** This body comes back with the
// ordinary 201, carrying `error: 'you have already voted'`, and the frontend
// branches on that exact string. `add` and `delete` are what the UI uses to
// adjust its counters optimistically.
//
// ⚠️ `delete` is always `0` on a recorded vote, and the field stays anyway: the
// response shape is what the frontend parses, and it is cheaper to keep the
// number than to make every client conditional on a date.
export class VoteResponseDto {
  @ApiProperty({
    description:
      'The value of the vote this call removed, or 0. Non-zero only when changing sides.',
    example: 0,
  })
  delete!: number;

  @ApiProperty({
    description: "`'you have already voted'` when the same vote was already cast, otherwise null.",
    type: String,
    nullable: true,
    example: null,
  })
  error!: string | null;

  @ApiProperty({ description: 'The value of the vote this call recorded, or 0.', example: 1 })
  add!: number;
}

export class PlaybackResponseDto {
  @ApiProperty({ description: 'Id of the appended playback row.', example: 3814 })
  id!: number;
}
