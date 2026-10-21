import type { Clip, ClipListItem } from '#/domain/clips/clip.entity';
import type { VoteOutcome, VoteValue } from '#/domain/clips/vote.entity';
import type { Episode } from '#/domain/episodes/episode.entity';
import type { Tag } from '#/domain/tags/tag.entity';
import type { ClipDto, ClipListItemDto, ClipTagDto, VoteResponseDto } from './clip.dto';

/**
 * DTO → entity. The two differ in three ways, which is exactly why this file
 * exists rather than the repository returning the parsed payload:
 * a tag is `{ clipId, tag }` on the wire and a plain string in the domain, the
 * episode's `date` is text on the wire and an instant in the domain, and a
 * vote's answer is `{ add, delete, error }` on the wire and a two-shape outcome
 * in the domain.
 */

/** Shared with `episodes/episode.mapper.ts`: the same `{ clipId, tag }` rows
 *  ride along inside an episode's clips. */
export function toTags(tags: readonly ClipTagDto[]): Tag[] {
  return tags.map((entry) => entry.tag);
}

export function toEpisode(dto: ClipDto['episode']): Episode {
  return {
    id: dto.id,
    title: dto.title,
    cover: dto.cover,
    file: dto.file,
    originalUrl: dto.originalUrl,
    date: dto.date,
  };
}

export function toClip(dto: ClipDto): Clip {
  return {
    id: dto.id,
    title: dto.title,
    start: dto.start,
    end: dto.end,
    episode: toEpisode(dto.episode),
    tags: toTags(dto.tags),
    up: dto.up,
  };
}

export function toClipListItem(dto: ClipListItemDto): ClipListItem {
  return {
    ...toClip(dto),
    points: dto.points,
  };
}

/**
 * ⚠️ Where the 201-that-means-"no" is turned into something a view can switch
 * on. Any non-null `error` is a refusal — the backend has exactly one string
 * for it today, and treating an unknown one as success would silently
 * double-count a vote that was never stored.
 *
 * `add` is `number` on the wire but only ever `1` or `0`; the value the caller
 * asked for is what the server echoes back on success, so the outcome is built
 * from it rather than from a cast.
 *
 * ⚠️ `delete` is read and discarded. There is no "changing your mind" with a
 * single vote, but the server still sends the field, always `0`, and the domain
 * says `removed: 0` rather than pretending the number could be anything else.
 */
export function toVoteOutcome(dto: VoteResponseDto, requested: VoteValue): VoteOutcome {
  if (dto.error !== null) {
    return { status: 'already-voted' };
  }
  return { status: 'recorded', added: requested, removed: 0 };
}
