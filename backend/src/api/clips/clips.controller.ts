import {
  Body,
  Controller,
  Get,
  Headers,
  Logger,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ClipsService } from './clips.service';
import { IPaginationResponse } from '../../common/DTO/IPaginationResponse';
import { Clip } from '../../database/entities/Clip';
import { CreateClipDTO } from './DTO/request/CreateClipDTO';
import { QueryOptionsDTO } from './DTO/request/QueryOptionsDTO';

@Controller('clips')
export class ClipsController {
  private readonly logger = new Logger(ClipsController.name);

  constructor(private readonly clipsService: ClipsService) {}

  @Get('/')
  async getClips(
    @Query() query: QueryOptionsDTO,
  ): Promise<IPaginationResponse<Clip>> {
    return await this.clipsService.getClips(query);
  }

  @Get('/:id')
  async getClip(@Param() params) {
    return await this.clipsService.getClip(params.id);
  }

  @Post('/:id/play')
  async playClip(@Param() params, @Req() request, @Headers() headers) {
    return await this.clipsService.playClip(
      params.id,
      headers['x-forwarded-for'] || request.ip,
    );
  }

  @Post('/:id/vote/:value')
  async vote(@Param() params, @Req() request, @Headers() headers) {
    return await this.clipsService.vote(
      params.id,
      parseInt(params.value, 10),
      headers['x-forwarded-for'] || request.ip,
    );
  }

  @Post('/:id/tag/:value')
  async addTag(@Param() params, @Req() request, @Headers() headers) {
    return await this.clipsService.addTag(
      params.id,
      params.value,
      headers['x-forwarded-for'] || request.ip,
    );
  }

  @Post('/')
  async addClip(
    @Body() createClipDTO: CreateClipDTO,
    @Req() request,
    @Headers() headers,
  ) {
    return await this.clipsService.addClip(
      createClipDTO,
      headers['x-forwarded-for'] || request.ip,
    );
  }
}
