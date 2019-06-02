import {Test, TestingModule} from '@nestjs/testing';
import {ClipsService} from './clips.service';
import {DatabaseModule} from '../../database/database.module';
import {TypeOrmModule} from '@nestjs/typeorm';
import {Episode} from '../../database/entities/Episode';
import {Clip} from '../../database/entities/Clip';
import {Vote} from '../../database/entities/Vote';
import {Tag} from '../../database/entities/Tag';
import {Playback} from '../../database/entities/Playback';

describe('ClipsService', () => {
  let service: ClipsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        DatabaseModule,
        TypeOrmModule.forFeature([Episode, Clip, Vote, Tag, Playback]),
      ],
      providers: [ClipsService],
    }).compile();

    service = module.get<ClipsService>(ClipsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
