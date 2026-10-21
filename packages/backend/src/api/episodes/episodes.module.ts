import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { Clip } from '../../database/entities/Clip.entity';
import { Episode } from '../../database/entities/Episode.entity';
import { EpisodeAudioProxy } from './episode-audio.proxy';
import { EpisodesController } from './episodes.controller';
import { EpisodesService } from './episodes.service';

@Module({
  imports: [MikroOrmModule.forFeature([Episode, Clip])],
  controllers: [EpisodesController],
  providers: [EpisodesService, EpisodeAudioProxy],
  exports: [EpisodesService],
})
export class EpisodesModule {}
