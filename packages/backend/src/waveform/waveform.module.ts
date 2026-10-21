import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { Episode } from '../database/entities/Episode.entity';
import { EpisodeDownloader } from './episode-download';
import { WaveformAnalyzer } from './waveform-analyzer';
import { WaveformService } from './waveform.service';

// ⚠️ No controller, like `IngestModule` — measuring an episode has no HTTP
// surface of its own. It runs from `IngestScheduler` (chained after every
// ingestion tick) or from `waveform.cli.ts` (a human, locally). The READ side,
// `GET /episodes/:id/waveform`, lives in `EpisodesModule` instead: it only
// ever runs a `select`, so it has no reason to depend on this module at all.
@Module({
  imports: [MikroOrmModule.forFeature([Episode])],
  providers: [WaveformService, WaveformAnalyzer, EpisodeDownloader],
  exports: [WaveformService],
})
export class WaveformModule {}
