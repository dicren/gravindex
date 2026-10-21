import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ClipsModule } from './api/clips/clips.module';
import { EpisodesModule } from './api/episodes/episodes.module';
import { HealthModule } from './api/health/health.module';
import { TagsModule } from './api/tags/tags.module';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { IngestModule } from './ingest/ingest.module';
import { SpaModule } from './spa/spa.module';

// ⚠️ Every module is registered here, so a feature never has to edit this file
// (or `package.json`). Adding an endpoint to `clips` is a change inside
// `api/clips/`, full stop.
@Module({
  imports: [
    ConfigModule.forRoot({
      // ⚠️ The ROOT `.env`, two levels up — one file feeds both
      // `docker-compose.yml`'s `${...}` substitution and local, non-docker dev.
      // Paths are resolved against the process CWD, which for
      // `npm run -w packages/backend <script>` is this package's directory.
      //
      // ⚠️ Real environment variables WIN over the file: `@nestjs/config` only
      // assigns a parsed key when it is not already in `process.env`. That is
      // what makes the docker case (values injected into the container's
      // environment, no file at all) work with the same code.
      envFilePath: [`.env.${process.env.NODE_ENV}`, '.env', '../../.env'],
      isGlobal: true,
    }),
    // Registered here rather than inside `IngestModule` so the cron machinery
    // exists exactly once.
    ScheduleModule.forRoot(),
    DatabaseModule,

    HealthModule,
    ClipsModule,
    EpisodesModule,
    TagsModule,
    AuthModule,
    IngestModule,

    // ⚠️ LAST on purpose: `SpaModule` owns the `index.html` catch-all, and Nest
    // matches routes in declaration order. Anything registered after it would
    // be unreachable — with a 404, not an error.
    SpaModule,
  ],
})
export class AppModule {}
