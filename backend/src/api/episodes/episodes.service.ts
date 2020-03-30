import { Injectable, NotFoundException } from '@nestjs/common';
import { Episode } from '../../database/entities/Episode';
import { Like, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { PaginationResults } from '../../queryOptions/paginationResults';
import { PaginationResultInterface } from '../../queryOptions/PaginationResultsInterface';
import { OptionBuilder } from '../../queryOptions/OptionBuilder';
import { Clip } from '../../database/entities/Clip';
import { Vote } from '../../database/entities/Vote';
import { QueryOptionsDTO } from './DTO/QueryOptionsDTO';

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
  ): Promise<PaginationResultInterface<Episode>> {
    let options = {
      order: { date: 'DESC' },
    };

    if (queryOptions.limit || queryOptions.page) {
      options = { ...options, ...OptionBuilder.pagination(queryOptions) };
    }

    if (queryOptions.search) {
      // @ts-ignore
      options.where = {
        title: Like(`%${queryOptions.search}%`),
      };
    }

    // @ts-ignore
    const [results, total] = await this.episodeRepository.findAndCount(options);

    return new PaginationResults({
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
