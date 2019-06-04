import {Test, TestingModule} from '@nestjs/testing';
import {ParserController} from './parser.controller';
import {DatabaseModule} from '../../database/database.module';
import {TypeOrmModule} from '@nestjs/typeorm';
import {Episode} from '../../database/entities/Episode';
import {ParserService} from './parser.service';

describe('Parser Controller', () => {
  let controller: ParserController;
  let provider: ParserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [DatabaseModule, TypeOrmModule.forFeature([Episode])],
      controllers: [ParserController],
      providers: [ParserService],
    }).compile();

    controller = module.get<ParserController>(ParserController);
    provider = module.get<ParserService>(ParserService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
