import { Readable } from 'node:stream';
import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { ClipTagDto } from '../clips/dto/clip-response.dto';
import { Episode } from '../../database/entities/Episode.entity';
import { downsamplePeaks, sliceBounds } from '../../waveform/waveform-peaks';
import { WAVEFORM_POINTS_PER_SECOND } from '../../waveform/waveform.constants';
import {
  buildWaveformSliceQuery,
  buildWaveformTotalQuery,
  WaveformSliceRow,
  WaveformTotalRow,
} from '../../waveform/waveform.sql';
import { EpisodeAudioProxy } from './episode-audio.proxy';
import {
  EpisodeClipDto,
  EpisodeDetailDto,
  EpisodeDto,
  EpisodeListItemDto,
  EpisodeListResponseDto,
  EpisodeWaveformDto,
} from './dto/episode-response.dto';
import { EpisodesQueryDto } from './dto/episodes-query.dto';
import { EpisodeWaveformQueryDto, fromOf, pointsOf } from './dto/episode-waveform-query.dto';
import {
  buildEpisodeDetailQuery,
  buildEpisodeListQuery,
  EpisodeColumns,
  EpisodeDetailRow,
  EpisodeListRow,
  hasClip,
  isPopulatedEpisodeRow,
  PopulatedEpisodeDetailRow,
  PopulatedEpisodeListRow,
} from './episodes.sql';

const EMPTY_WAVEFORM = (from: number, to: number): EpisodeWaveformDto => ({
  from,
  to,
  points: 0,
  peaks: '',
});

@Injectable()
export class EpisodesService {
  constructor(
    private readonly em: EntityManager,
    private readonly episodeAudioProxy: EpisodeAudioProxy,
  ) {}

  async list(query: EpisodesQueryDto): Promise<EpisodeListResponseDto> {
    const { sql, params } = buildEpisodeListQuery(query);

    // Raw, like the clips list, and for the same reason: the page and its
    // unpaginated total come out of ONE statement. ⚠️ Everything the client
    // controls is a `?` binding — there is no client-influenced fragment here at
    // all, since `/episodes` takes no `order`.
    const rows = (await this.em
      .getConnection()
      .execute(sql, params)) as unknown as EpisodeListRow[];

    const first = rows[0];
    if (first === undefined) {
      // Cannot happen — the `total` CTE always yields a row — but the type says
      // it can, and a silent `0` beats a crash if it ever does.
      return { results: [], total: 0 };
    }

    return {
      results: rows.filter(isPopulatedEpisodeRow).map((row) => EpisodesService.toListItem(row)),
      total: first.total,
    };
  }

  async findOne(id: number): Promise<EpisodeDetailDto> {
    const { sql, params } = buildEpisodeDetailQuery(id);

    const rows = (await this.em
      .getConnection()
      .execute(sql, params)) as unknown as EpisodeDetailRow[];

    const first = rows[0];
    if (first === undefined) {
      // Bare, so the body is the standard `{ statusCode, message: 'Not Found' }`.
      throw new NotFoundException();
    }

    return {
      ...EpisodesService.toEpisodeDto(first),
      // An episode with no clips still produced one row (the left join), whose
      // clip columns are all null.
      clips: rows.filter(hasClip).map((row) => EpisodesService.toClipDto(row)),
    };
  }

  // `GET /episodes/:id/waveform`. Two round trips, deliberately: the byte
  // range worth asking Postgres for depends on how long the stored column IS,
  // and there is no way to know that without asking first — see
  // `waveform.sql.ts`, `buildWaveformTotalQuery`.
  async getWaveform(id: number, query: EpisodeWaveformQueryDto): Promise<EpisodeWaveformDto> {
    const totalQuery = buildWaveformTotalQuery(id);
    const totalRows = (await this.em
      .getConnection()
      .execute(totalQuery.sql, totalQuery.params)) as unknown as WaveformTotalRow[];

    const totalRow = totalRows[0];
    if (totalRow === undefined) {
      // No episode with this id at all — the same 404 `findOne` gives.
      throw new NotFoundException();
    }

    const from = fromOf(query);
    const totalBytes = totalRow.total_bytes ?? 0;
    if (totalBytes === 0) {
      // The episode exists but nothing has measured it yet — an ordinary,
      // temporary state (see the root CLAUDE.md, "waveform"), not a 404.
      // The frontend falls back to `GravWave`'s drawn placeholder.
      return EMPTY_WAVEFORM(from, query.to ?? from);
    }

    const totalSeconds = totalBytes / WAVEFORM_POINTS_PER_SECOND;
    const { offset, length } = sliceBounds(from, query.to ?? totalSeconds, totalBytes);

    if (length === 0) {
      return EMPTY_WAVEFORM(
        offset / WAVEFORM_POINTS_PER_SECOND,
        offset / WAVEFORM_POINTS_PER_SECOND,
      );
    }

    const sliceQuery = buildWaveformSliceQuery(id, offset, length);
    const sliceRows = (await this.em
      .getConnection()
      .execute(sliceQuery.sql, sliceQuery.params)) as unknown as WaveformSliceRow[];

    const peaks = sliceRows[0]?.peaks ?? Buffer.alloc(0);
    const resampled = downsamplePeaks(peaks, pointsOf(query));

    return {
      from: offset / WAVEFORM_POINTS_PER_SECOND,
      to: (offset + length) / WAVEFORM_POINTS_PER_SECOND,
      points: resampled.length,
      peaks: Buffer.from(resampled).toString('base64'),
    };
  }

  // `GET /episodes/:id/audio`. A dumb byte pipe: no audio processing happens
  // in this process at all. It exists only because `episode.file`'s host sends
  // no CORS headers — the frontend cuts a clip client-side by reading MP3
  // frames out of `Range` slices, and needs a same-origin host to `fetch()`
  // them from. See the root CLAUDE.md, "Audio download".
  async getAudio(id: number, range: string | undefined, res: Response): Promise<StreamableFile> {
    const episode = await this.em.findOne(Episode, id, { fields: ['file'] });
    if (episode === null) {
      throw new NotFoundException();
    }

    const upstream = await this.episodeAudioProxy.open(episode.file, range);
    // A closed tab or a cancelled download must not leave a socket open to
    // gravina82.com pulling bytes nobody is reading any more.
    res.on('close', () => upstream.abort());

    res.status(upstream.status);
    res.set('accept-ranges', 'bytes');
    // Forced, not forwarded: what actually matters (whether the Range was
    // honoured, how big the slice is) is reforwarded below verbatim, but the
    // content type is ours to declare regardless of what the upstream sent.
    res.set('content-type', 'audio/mpeg');
    const contentRange = upstream.headers.get('content-range');
    if (contentRange !== null) {
      res.set('content-range', contentRange);
    }
    const contentLength = upstream.headers.get('content-length');
    if (contentLength !== null) {
      res.set('content-length', contentLength);
    }

    if (upstream.body === null) {
      return new StreamableFile(Buffer.alloc(0));
    }
    return new StreamableFile(Readable.fromWeb(upstream.body));
  }

  // -------------------------------------------------------------- helpers

  // The list adds the clip count; the detail does not (it carries the clips).
  private static toListItem(row: PopulatedEpisodeListRow): EpisodeListItemDto {
    return { ...EpisodesService.toEpisodeDto(row), clipCount: row.clip_count };
  }

  private static toEpisodeDto(row: EpisodeColumns): EpisodeDto {
    return {
      id: row.id,
      title: row.title,
      cover: row.cover,
      file: row.file,
      originalUrl: row.original_url,
      date: row.date,
    };
  }

  private static toClipDto(row: PopulatedEpisodeDetailRow): EpisodeClipDto {
    return {
      id: row.clip_id,
      title: row.clip_title,
      start: row.clip_start,
      end: row.clip_end,
      tags: row.tags.map((tag): ClipTagDto => ({ clipId: row.clip_id, tag })),
      // ⚠️ Numbers. `::int` in the query, so the driver's string never reaches
      // the response — see `EpisodeClipDto`.
      up: row.up,
    };
  }
}
