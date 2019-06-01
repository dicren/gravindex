import { Module } from '@nestjs/common';
import { ParserModule } from './api/parser/parser.module';
import { DatabaseModule } from './database/database.module';
import { ConfigModule } from './config/config.module';
import { EpisodesModule } from './api/episodes/episodes.module';
import { ClipsModule } from './api/clips/clips.module';
import { TagsModule } from './api/tags/tags.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    ParserModule,
    EpisodesModule,
    ClipsModule,
    TagsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
