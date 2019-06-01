import { Test, TestingModule } from '@nestjs/testing';
import { ClipsController } from './clips.controller';

describe('Clips Controller', () => {
  let controller: ClipsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClipsController],
    }).compile();

    controller = module.get<ClipsController>(ClipsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
