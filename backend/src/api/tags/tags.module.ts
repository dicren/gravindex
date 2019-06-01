import { Module } from '@nestjs/common';
import { TagsService } from './tags.service';
import { TagsController } from './tags.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tag } from '../../database/entities/Tag';

@Module({
  imports: [TypeOrmModule.forFeature([Tag])],
  providers: [TagsService],
  controllers: [TagsController],
})
export class TagsModule {}
