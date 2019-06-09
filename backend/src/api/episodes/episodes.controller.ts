import { Controller, Get, Logger, Param, Query } from '@nestjs/common';
import { EpisodesService } from './episodes.service';
import { PaginationResultInterface } from '../../queryOptions/PaginationResultsInterface';
import { Episode } from '../../database/entities/Episode';
import { QueryOptionsDTO } from './DTO/QueryOptionsDTO';

@Controller('episodes')
export class EpisodesController {
  private readonly logger = new Logger(EpisodesController.name);

  constructor(private readonly episodesService: EpisodesService) {}

  @Get('/')
  async getEpisodes(
    @Query() query: QueryOptionsDTO,
  ): Promise<PaginationResultInterface<Episode>> {
    return await this.episodesService.getEpisodes(query);
  }

  @Get('/:id')
  async getEpisode(@Param() params: { id: number }) {
    return await this.episodesService.getEpisode(params.id);
  }
}
