import {Test, TestingModule} from '@nestjs/testing';
import {ParserService} from './parser.service';
import {DatabaseModule} from "../../database/database.module";
import {TypeOrmModule} from "@nestjs/typeorm";
import {Episode} from "../../database/entities/Episode";

describe('ParserService', () => {
  let service: ParserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        DatabaseModule,
        TypeOrmModule.forFeature([Episode]),
      ],
      providers: [ParserService],
    }).compile();

    service = module.get<ParserService>(ParserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
