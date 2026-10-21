import { ApiProperty } from '@nestjs/swagger';
import { ClipTagDto } from '../../clips/dto/clip-response.dto';
import { PaginatedResponseDto } from '../../../common/dto/paginated-response.dto';

// An episode as `GET /episodes` returns it.
//
// ⚠️ `description` is absent on purpose (`lazy`) and so is `duration`: the RSS
// ingestion fills that column and many rows have `null` in it, so surfacing it
// here would emit `duration: null` on every row for nothing. Exposing it is a
// frontend-visible feature, not a side effect of the schema. `clips` is absent
// too: the list endpoint does not carry them.
export class EpisodeDto {
  @ApiProperty({
    description: 'Public identifier. `/episode/<id>-<slug>` is the shareable URL.',
    example: 63,
  })
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

// A row of `GET /episodes`.
//
// ⚠️ `clipCount`, NOT the clips. The episode list prints `7 cortes` / `sin
// cortes` on every row and offers a "solo con cortes" toggle, and the list does
// not carry clips — embedding 11 of them on the busiest row to render the number
// "11" would be a different endpoint. One `COUNT` grouped by episode, over 395 rows.
//
// It lives here rather than on `EpisodeDto` so `GET /episodes/:id` does not
// inherit it: that response already carries the clips themselves, and a count
// beside them is a second source of truth for `clips.length`.
export class EpisodeListItemDto extends EpisodeDto {
  @ApiProperty({ description: 'How many clips have been cut from this episode.', example: 7 })
  clipCount!: number;
}

export class EpisodeListResponseDto extends PaginatedResponseDto<EpisodeListItemDto> {
  @ApiProperty({ type: () => [EpisodeListItemDto] })
  results!: EpisodeListItemDto[];
}

// A clip as it rides along inside `GET /episodes/:id`.
//
// ⚠️ It carries `up` but **not** `points`, and it carries no `episode` (it is
// already inside one). That asymmetry with `GET /clips` — which has both plus
// the episode — is the contract, and the frontend's row reads whichever it is
// given.
export class EpisodeClipDto {
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

  @ApiProperty({ type: () => [ClipTagDto] })
  tags!: ClipTagDto[];

  // ⚠️ **Numbers, not strings.** A raw `SUM` through a joined subquery comes back
  // from the driver as a string, so the query casts it. The contract is numeric
  // everywhere.
  //
  // ⚠️ No `down`, here or anywhere else: every vote is positive
  // (`clips/dto/clip-params.dto.ts`).
  @ApiProperty({ description: 'Number of upvotes.', example: 15 })
  up!: number;
}

export class EpisodeDetailDto extends EpisodeDto {
  @ApiProperty({
    description: 'Every clip cut from this episode, oldest id first. Empty when there are none.',
    type: () => [EpisodeClipDto],
  })
  clips!: EpisodeClipDto[];
}

// `GET /episodes/:id/waveform`. ⚠️ An episode that exists but has no waveform
// measured yet answers 200 with `points: 0` and `peaks: ''`, never a 404 — the
// same "empty, not missing" choice `GET /clips/:id/related` makes for a clip
// with no tags. The frontend falls back to `GravWave`'s drawn placeholder.
export class EpisodeWaveformDto {
  @ApiProperty({
    description:
      'Seconds into the episode this slice starts at, clamped to what the stored ' +
      'waveform actually covers.',
    example: 0,
  })
  from!: number;

  @ApiProperty({
    description: 'Seconds into the episode this slice ends at, clamped the same way.',
    example: 60,
  })
  to!: number;

  @ApiProperty({
    description: 'How many bytes `peaks` carries. May be fewer than requested — never more.',
    example: 160,
  })
  points!: number;

  @ApiProperty({
    description:
      'One unsigned byte per point (0–255, a normalized peak), base64-encoded. ' +
      'Empty string when the episode has no waveform yet.',
    example: 'AAECAw==',
  })
  peaks!: string;
}
