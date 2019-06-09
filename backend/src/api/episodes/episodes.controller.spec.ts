import { Test, TestingModule } from '@nestjs/testing';
import { EpisodesController } from './episodes.controller';
import { DatabaseModule } from '../../database/database.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Episode } from '../../database/entities/Episode';
import { Clip } from '../../database/entities/Clip';
import { Vote } from '../../database/entities/Vote';
import { EpisodesService } from './episodes.service';

describe('Episodes Controller', () => {
  let controller: EpisodesController;
  let provider: EpisodesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        DatabaseModule,
        TypeOrmModule.forFeature([Episode, Clip, Vote]),
      ],
      controllers: [EpisodesController],
      providers: [EpisodesService],
    }).compile();

    controller = module.get<EpisodesController>(EpisodesController);
    provider = module.get<EpisodesService>(EpisodesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
