import { ApiProperty } from '@nestjs/swagger';
import { Clip } from '../../database/entities/Clip.entity';
import { User } from '../../database/entities/User.entity';

/**
 * ⚠️ Every admin route answers with one of these, never with a raw entity.
 *
 * `User.passwordHash` already carries MikroORM's `hidden: true`, which is the
 * real guard against leaking a hash — but a hand-built response object is the
 * second wall, and the cheap one: a field that is never copied cannot be
 * serialized by any future change to how entities are returned.
 */
export class LoginResponseDto {
  @ApiProperty({ description: 'Bearer token for the `Authorization` header.' })
  accessToken!: string;

  @ApiProperty()
  username!: string;

  static from(accessToken: string, user: User): LoginResponseDto {
    const dto = new LoginResponseDto();
    dto.accessToken = accessToken;
    dto.username = user.username;
    return dto;
  }
}

/** The "is the token in this browser still good?" probe's answer. */
export class AdminIdentityDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  username!: string;

  static from(user: User): AdminIdentityDto {
    const dto = new AdminIdentityDto();
    dto.id = user.id;
    dto.username = user.username;
    return dto;
  }
}

/**
 * A clip as the admin screens see it.
 *
 * ⚠️ Deliberately NOT the public clip shape: no `up`/`down`/`points` (those are
 * aggregated at read time and their presence/absence is a frontend contract —
 * root AGENTS.md, "Vote counts are not a column") and no populated episode. The
 * admin surface owes nothing to the public contract and can afford to be flat.
 */
export class AdminClipDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  title!: string;

  @ApiProperty({ description: 'Seconds from the start of the episode.' })
  start!: number;

  @ApiProperty({ description: 'Seconds from the start of the episode.' })
  end!: number;

  @ApiProperty()
  episodeId!: number;

  @ApiProperty({ type: [String] })
  tags!: string[];

  static from(clip: Clip, tags: string[]): AdminClipDto {
    const dto = new AdminClipDto();
    dto.id = clip.id;
    dto.title = clip.title;
    dto.start = clip.start;
    dto.end = clip.end;
    dto.episodeId = clip.episode.id;
    dto.tags = tags;
    return dto;
  }
}
