import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  RequiredVoterToken,
  VOTER_TOKEN_HEADER,
  VoterToken,
} from '../../common/http/voter-token.decorator';
import { ClipsService } from './clips.service';
import { ClipIdParamDto, TagParamsDto, VoteParamsDto } from './dto/clip-params.dto';
import {
  ClipDto,
  ClipListItemDto,
  ClipListResponseDto,
  ClipTagDto,
  PlaybackResponseDto,
  VoteResponseDto,
} from './dto/clip-response.dto';
import { ClipsQueryDto } from './dto/clips-query.dto';
import { CreateClipDto } from './dto/create-clip.dto';

// ⚠️ **This document is the published contract.** The frontend's whole HTTP
// client is generated from it (`@hey-api/openapi-ts`), so every handler carries
// a typed response DTO and typed parameters: an untyped `@Param() params` parsed
// with `parseInt` inside the handler would generate a client that knows nothing.
@ApiTags('clips')
@Controller('clips')
export class ClipsController {
  constructor(private readonly clipsService: ClipsService) {}

  @Get()
  @ApiOperation({
    summary: 'The clip library: search, tag filter, sort, paginate',
    description:
      'Every row carries its `up`, its `points` (the same number, kept because `order=points` ' +
      'travels in shared links), its episode and its tags. `total` is the ' +
      'number of matching rows ignoring pagination, so a page past the end returns an empty ' +
      '`results` with the real total.',
  })
  @ApiOkResponse({ type: ClipListResponseDto })
  @ApiBadRequestResponse({ description: 'Unknown `order`, out-of-range `page`/`limit`.' })
  list(@Query() query: ClipsQueryDto): Promise<ClipListResponseDto> {
    return this.clipsService.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One clip, by its public id',
    description:
      'Carries `up`, aggregated from the vote table at read time — the clip permalink and the ' +
      'global player both draw a vote count for a clip opened by URL, and there is no other ' +
      'source for it. ⚠️ No `down`, and no `points` (it would be a second name for `up`).',
  })
  @ApiOkResponse({ type: ClipDto })
  @ApiNotFoundResponse()
  findOne(@Param() params: ClipIdParamDto): Promise<ClipDto> {
    return this.clipsService.findOne(params.id);
  }

  // ⚠️ Declared before nothing in particular — Express matches `:id` against a
  // SINGLE path segment, so `/clips/137/related` can never be read as a clip id
  // whatever the order. It sits next to `findOne` because that is the screen it
  // belongs to.
  @Get(':id/related')
  @ApiOperation({
    summary: 'Clips that share at least one tag with this one',
    description:
      'Ordered by how many tags they share, then by `up`, then by descending id, and capped at ' +
      'six. Rows are the same shape as `GET /clips` because the permalink renders them with the ' +
      'same component. A clip with no tags answers an empty array.',
  })
  @ApiOkResponse({ type: [ClipListItemDto] })
  @ApiNotFoundResponse()
  findRelated(@Param() params: ClipIdParamDto): Promise<ClipListItemDto[]> {
    return this.clipsService.findRelated(params.id);
  }

  @Post()
  @ApiOperation({ summary: 'Cut a new clip from an episode' })
  @ApiHeader({
    name: VOTER_TOKEN_HEADER,
    required: false,
    description:
      'Anonymous per-browser UUID. Stored as the submitter trail; never treated as identity.',
  })
  @ApiCreatedResponse({ type: ClipDto })
  @ApiBadRequestResponse({ description: '`end` not greater than `start`, empty title, bad token.' })
  @ApiNotFoundResponse({ description: 'No such episode.' })
  create(@Body() dto: CreateClipDto, @VoterToken() token: string | null): Promise<ClipDto> {
    return this.clipsService.create(dto, token);
  }

  @Post(':id/play')
  @ApiOperation({
    summary: 'Append one play to the counter',
    description: 'Fire-and-forget. Stores no identity of any kind — no IP, not even the token.',
  })
  @ApiCreatedResponse({ type: PlaybackResponseDto })
  @ApiNotFoundResponse()
  play(@Param() params: ClipIdParamDto): Promise<PlaybackResponseDto> {
    return this.clipsService.play(params.id);
  }

  @Post(':id/vote/:value')
  @ApiOperation({
    summary: 'Vote a clip up',
    description:
      '⚠️ A REPEATED VOTE IS NOT AN HTTP ERROR. It answers the ordinary 201 with ' +
      "`error: 'you have already voted'` in the body, and the frontend branches on that " +
      'string. Changing your mind answers `{ delete: <old>, add: <new> }`, which the UI uses ' +
      'to adjust its counters. Deduplication is per `(clip, token)`, so the header is required.',
  })
  @ApiHeader({
    name: VOTER_TOKEN_HEADER,
    required: true,
    description: 'Anonymous per-browser UUID. Required: it is what deduplicates the vote.',
  })
  @ApiCreatedResponse({ type: VoteResponseDto })
  @ApiBadRequestResponse({
    description: '`value` other than 1 (a negative value included), or a missing/malformed token.',
  })
  @ApiNotFoundResponse()
  vote(
    @Param() params: VoteParamsDto,
    @RequiredVoterToken() token: string,
  ): Promise<VoteResponseDto> {
    return this.clipsService.vote(params.id, params.value, token);
  }

  @Post(':id/tag/:value')
  @ApiOperation({
    summary: 'Attach a tag to a clip',
    description:
      'Unlike voting, a repeat here really is a 409 — the two write paths disagree with each ' +
      'other and both behaviours are the specification.',
  })
  @ApiHeader({
    name: VOTER_TOKEN_HEADER,
    required: false,
    description: 'Anonymous per-browser UUID. Stored as the submitter trail.',
  })
  @ApiCreatedResponse({ type: ClipTagDto })
  @ApiConflictResponse({ description: 'Tag repeated' })
  @ApiNotFoundResponse()
  addTag(@Param() params: TagParamsDto, @VoterToken() token: string | null): Promise<ClipTagDto> {
    return this.clipsService.addTag(params.id, params.value, token);
  }
}
