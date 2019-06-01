import { Module } from '@nestjs/common';
import { ParserController } from './parser.controller';
import { ParserService } from './parser.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Episode } from '../../database/entities/Episode';

@Module({
  imports: [TypeOrmModule.forFeature([Episode])],
  controllers: [ParserController],
  providers: [ParserService],
})
export class ParserModule {}
