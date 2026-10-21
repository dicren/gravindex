import { Controller, Get, Headers, Param, Query, Res, StreamableFile } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { EpisodeIdParamDto } from './dto/episode-params.dto';
import {
  EpisodeDetailDto,
  EpisodeListResponseDto,
  EpisodeWaveformDto,
} from './dto/episode-response.dto';
import { EpisodesQueryDto } from './dto/episodes-query.dto';
import { EpisodeWaveformQueryDto } from './dto/episode-waveform-query.dto';
import { EpisodesService } from './episodes.service';

// ⚠️ This document is the published contract — the frontend's HTTP client is
// generated from it. Both handlers carry typed response DTOs and validated
// parameters: an untyped `@Param() params: { id: number }` or a query DTO without
// decorators would be invisible to both the contract and the validation.
@ApiTags('episodes')
@Controller('episodes')
export class EpisodesController {
  constructor(private readonly episodesService: EpisodesService) {}

  @Get()
  @ApiOperation({
    summary: 'The episode library: search by title, paginate',
    description:
      'Newest first, by publish date. Rows carry `clipCount` but no clips and no vote counts — ' +
      'that is what `GET /episodes/:id` is for. `withClips=true` keeps only the 61 episodes ' +
      'something has been cut from. `total` is the number of matching rows ignoring pagination, ' +
      'so a page past the end returns an empty `results` with the real total.',
  })
  @ApiOkResponse({ type: EpisodeListResponseDto })
  @ApiBadRequestResponse({ description: 'Out-of-range `page`/`limit`, or an unknown parameter.' })
  list(@Query() query: EpisodesQueryDto): Promise<EpisodeListResponseDto> {
    return this.episodesService.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One episode, with every clip cut from it',
    description:
      'Each clip carries its tags and its `up` count — but **not** `points`, and not its ' +
      'episode. The frontend reaches this route as `/episode/<id>-<slug>` and parses the ' +
      'leading integer itself.',
  })
  @ApiOkResponse({ type: EpisodeDetailDto })
  @ApiBadRequestResponse({ description: 'A non-numeric or non-positive id.' })
  @ApiNotFoundResponse()
  findOne(@Param() params: EpisodeIdParamDto): Promise<EpisodeDetailDto> {
    return this.episodesService.findOne(params.id);
  }

  // ⚠️ Declared next to `findOne`, same reasoning as `GET /clips/:id/related`:
  // Express matches `:id` against a single path segment, so `/episodes/63/waveform`
  // can never be read as an episode id.
  @Get(':id/waveform')
  @ApiOperation({
    summary: "The episode's measured waveform, sliced and resampled",
    description:
      'One unsigned byte per point, base64-encoded, `from`/`to` seconds into the episode. ' +
      '⚠️ An episode that exists but has not been measured yet answers 200 with `points: 0` ' +
      "and `peaks: ''` — not a 404. The frontend falls back to a drawn placeholder for those.",
  })
  @ApiOkResponse({ type: EpisodeWaveformDto })
  @ApiBadRequestResponse({ description: 'A non-numeric or out-of-range `from`/`to`/`points`.' })
  @ApiNotFoundResponse()
  getWaveform(
    @Param() params: EpisodeIdParamDto,
    @Query() query: EpisodeWaveformQueryDto,
  ): Promise<EpisodeWaveformDto> {
    return this.episodesService.getWaveform(params.id, query);
  }

  // ⚠️ Same reasoning as `:id/waveform` for why this sits next to `findOne`
  // rather than colliding with it: Express matches `:id` against one segment.
  @Get(':id/audio')
  @ApiOperation({
    summary: "A same-origin passthrough to the episode's mp3, for cutting a clip client-side",
    description:
      'gravina82.com sends no `Access-Control-*` headers, so the frontend cannot `fetch()` ' +
      'it directly to read MP3 frames out of a `Range` slice — which is how a clip is cut ' +
      'entirely in the browser, without a server-side re-encode. This endpoint forwards the ' +
      'incoming `Range` verbatim and streams the upstream response back untouched; **no audio ' +
      'processing happens in this process**. Playback is unaffected — the player still loads ' +
      'gravina82.com directly. No `Range` header serves the whole file. ⚠️ No cap on the ' +
      'requested span and nothing rate-limits this endpoint — a recorded, deliberate gap, see ' +
      'the root CLAUDE.md, "Known gaps".',
  })
  @ApiHeader({
    name: 'Range',
    required: false,
    description: 'Forwarded verbatim to the upstream mp3. Omit it to receive the whole file.',
  })
  @ApiResponse({
    status: 206,
    description: 'Partial Content — the upstream honoured the `Range`.',
    content: { 'audio/mpeg': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiOkResponse({
    description: 'The whole file — no `Range` was sent, or the upstream ignored it.',
    content: { 'audio/mpeg': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiBadRequestResponse({ description: 'A non-numeric or non-positive id.' })
  @ApiNotFoundResponse()
  @ApiResponse({ status: 502, description: "The episode's mp3 host answered with an error." })
  @ApiResponse({ status: 504, description: "The episode's mp3 host did not answer in time." })
  getAudio(
    @Param() params: EpisodeIdParamDto,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return this.episodesService.getAudio(params.id, range, res);
  }
}
