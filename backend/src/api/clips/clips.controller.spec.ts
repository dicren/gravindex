import { Test, TestingModule } from '@nestjs/testing';
import { ClipsController } from './clips.controller';
import { ClipsService } from './clips.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Episode } from '../../database/entities/Episode';
import { Clip } from '../../database/entities/Clip';
import { Vote } from '../../database/entities/Vote';
import { Tag } from '../../database/entities/Tag';
import { Playback } from '../../database/entities/Playback';
import { DatabaseModule } from '../../database/database.module';

describe('Clips Controller', () => {
  let controller: ClipsController;
  let provider: ClipsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        DatabaseModule,
        TypeOrmModule.forFeature([Episode, Clip, Vote, Tag, Playback]),
      ],
      controllers: [ClipsController],
      providers: [ClipsService],
    }).compile();

    controller = module.get<ClipsController>(ClipsController);
    provider = module.get<ClipsService>(ClipsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
