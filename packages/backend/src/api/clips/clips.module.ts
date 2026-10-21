import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { Clip } from '../../database/entities/Clip.entity';
import { Episode } from '../../database/entities/Episode.entity';
import { Playback } from '../../database/entities/Playback.entity';
import { Tag } from '../../database/entities/Tag.entity';
import { Vote } from '../../database/entities/Vote.entity';
import { ClipsController } from './clips.controller';
import { ClipsService } from './clips.service';

// `Episode` is in the feature list because `POST /clips` resolves the episode a
// clip is cut from before inserting.
@Module({
  imports: [MikroOrmModule.forFeature([Clip, Episode, Vote, Tag, Playback])],
  controllers: [ClipsController],
  providers: [ClipsService],
  exports: [ClipsService],
})
export class ClipsModule {}
