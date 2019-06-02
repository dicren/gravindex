import {Test, TestingModule} from '@nestjs/testing';
import {TagsController} from './tags.controller';
import {DatabaseModule} from '../../database/database.module';
import {TypeOrmModule} from '@nestjs/typeorm';
import {Tag} from '../../database/entities/Tag';
import {TagsService} from './tags.service';

describe('Tags Controller', () => {
  let controller: TagsController;
  let provider: TagsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        DatabaseModule,
        TypeOrmModule.forFeature([Tag]),
      ],
      controllers: [TagsController],
      providers: [TagsService],
    }).compile();

    controller = module.get<TagsController>(TagsController);
    provider = module.get<TagsService>(TagsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
