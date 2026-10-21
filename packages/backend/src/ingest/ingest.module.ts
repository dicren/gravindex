import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { Episode } from '../database/entities/Episode.entity';
import { WaveformModule } from '../waveform/waveform.module';
import { FeedClient } from './feed-client';
import { IngestScheduler } from './ingest.scheduler';
import { IngestService } from './ingest.service';

// ⚠️ No controller, and that is the design — not an omission to be filled in.
// Ingestion has **no HTTP surface at all**, protected or otherwise; it runs on
// a schedule (`IngestScheduler`) or from `ingest.cli.ts`. See root CLAUDE.md,
// "The API contract", item 2.
//
// ⚠️ `WaveformModule` is imported here, not the other way around: ingestion
// does not depend on waveforms existing, but `IngestScheduler` chains a
// waveform top-up after every tick, and `WaveformService` has to be reachable
// for that injection to resolve.
@Module({
  imports: [MikroOrmModule.forFeature([Episode]), WaveformModule],
  providers: [FeedClient, IngestService, IngestScheduler],
  exports: [IngestService],
})
export class IngestModule {}
