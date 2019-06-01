import { Module } from '@nestjs/common';
import { ClipsController } from './clips.controller';
import { ClipsService } from './clips.service';
import { Episode } from '../../database/entities/Episode';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Clip } from '../../database/entities/Clip';
import { Vote } from '../../database/entities/Vote';
import { Tag } from '../../database/entities/Tag';
import { Playback } from '../../database/entities/Playback';

@Module({
  imports: [TypeOrmModule.forFeature([Episode, Clip, Vote, Tag, Playback])],
  controllers: [ClipsController],
  providers: [ClipsService],
})
export class ClipsModule {}
