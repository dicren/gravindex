import { Injectable, NotFoundException } from '@nestjs/common';
import { Episode } from '../../database/entities/Episode';
import { Like, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { IPaginationResponse } from '../../common/DTO/IPaginationResponse';
import { Pagination } from '../../common/helpers/Pagination';
import { Clip } from '../../database/entities/Clip';
import { Vote } from '../../database/entities/Vote';
import { QueryOptionsDTO } from './DTO/request/QueryOptionsDTO';
import { PaginationResponse } from '../../common/DTO/paginationResponse';

@Injectable()
export class EpisodesService {
  constructor(
    @InjectRepository(Episode)
    private readonly episodeRepository: Repository<Episode>,
    @InjectRepository(Clip)
    private readonly clipRepository: Repository<Clip>,
    @InjectRepository(Vote)
    private readonly voteRepository: Repository<Vote>,
  ) {}

  async getEpisodes(
    queryOptions: QueryOptionsDTO,
  ): Promise<IPaginationResponse<Episode>> {
    const sql = this.episodeRepository
      .createQueryBuilder('episode')
      .addOrderBy('episode.date', 'DESC')
      .limit(Pagination.getLimit(queryOptions))
      .offset(Pagination.getOffset(queryOptions));

    if (queryOptions.search) {
      sql.where('episode.title LIKE :title', {
        title: `%${queryOptions.search}%`,
      });
    }

    const [results, total] = await sql.getManyAndCount();

    return new PaginationResponse({
      results,
      total,
    });
  }

  async getEpisode(id: number) {
    const episode = await this.episodeRepository.findOne({
      where: { id },
      relations: ['clips', 'clips.tags'],
    });

    if (episode) {
      const promises = [];
      for (const clip of episode.clips) {
        const promiseUp = this.voteRepository
          .count({ clip, value: 1 })
          .then((result) => {
            clip.up = result;
          });
        const promiseDown = this.voteRepository
          .count({ clip, value: -1 })
          .then((result) => {
            clip.down = result;
          });
        promises.push(promiseUp);
        promises.push(promiseDown);
      }

      await Promise.all(promises);

      return episode;
    } else {
      throw new NotFoundException();
    }
  }
}
