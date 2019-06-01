import { Module } from '@nestjs/common';
import { EpisodesController } from './episodes.controller';
import { EpisodesService } from './episodes.service';
import { Episode } from '../../database/entities/Episode';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Clip } from '../../database/entities/Clip';
import { Vote } from '../../database/entities/Vote';

@Module({
  imports: [TypeOrmModule.forFeature([Episode, Clip, Vote])],
  controllers: [EpisodesController],
  providers: [EpisodesService],
})
export class EpisodesModule {}
