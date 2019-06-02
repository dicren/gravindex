import {Test, TestingModule} from '@nestjs/testing';
import {EpisodesService} from './episodes.service';
import {DatabaseModule} from '../../database/database.module';
import {TypeOrmModule} from '@nestjs/typeorm';
import {Episode} from '../../database/entities/Episode';
import {Clip} from '../../database/entities/Clip';
import {Vote} from '../../database/entities/Vote';

describe('EpisodesService', () => {
  let service: EpisodesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        DatabaseModule,
        TypeOrmModule.forFeature([Episode, Clip, Vote]),
      ],
      providers: [EpisodesService],
    }).compile();

    service = module.get<EpisodesService>(EpisodesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
