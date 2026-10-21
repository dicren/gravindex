import type { EpisodeClip } from '#/domain/clips/clip.entity';
import type {
  Episode,
  EpisodeDetail,
  EpisodeListItem,
  EpisodeWaveform,
} from '#/domain/episodes/episode.entity';
import { toEpisode, toTags } from '#/infrastructure/clips/clip.mapper';
import type {
  EpisodeClipDto,
  EpisodeDetailDto,
  EpisodeDto,
  EpisodeListItemDto,
  EpisodeWaveformDto,
} from './episode.dto';

/** The episode's own six fields map exactly as they do inside a clip. */
export function toEpisodeEntity(dto: EpisodeDto): Episode {
  return toEpisode(dto);
}

/** A list row: the episode plus how many clips have been cut from it. */
export function toEpisodeListItem(dto: EpisodeListItemDto): EpisodeListItem {
  return { ...toEpisodeEntity(dto), clipCount: dto.clipCount };
}

export function toEpisodeClip(dto: EpisodeClipDto): EpisodeClip {
  return {
    id: dto.id,
    title: dto.title,
    start: dto.start,
    end: dto.end,
    tags: toTags(dto.tags),
    up: dto.up,
  };
}

export function toEpisodeDetail(dto: EpisodeDetailDto): EpisodeDetail {
  return {
    ...toEpisodeEntity(dto),
    clips: dto.clips.map(toEpisodeClip),
  };
}

/** `atob`, not `Buffer` — this runs in the browser, and `Buffer` is a Node
 *  global Vite does not polyfill here. An empty string (an unmeasured
 *  episode) decodes to an empty array without calling `atob` at all, since
 *  `atob('')` is itself valid but there is nothing to gain by going through it. */
function decodeBase64Bytes(base64: string): number[] {
  if (base64 === '') {
    return [];
  }

  const binary = atob(base64);
  const bytes = new Array<number>(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

export function toEpisodeWaveform(dto: EpisodeWaveformDto): EpisodeWaveform {
  return { from: dto.from, to: dto.to, peaks: decodeBase64Bytes(dto.peaks) };
}
