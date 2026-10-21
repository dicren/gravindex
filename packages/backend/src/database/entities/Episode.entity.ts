import { Collection } from '@mikro-orm/core';
import { Entity, Index, OneToMany, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { Clip } from './Clip.entity';

// An episode of the gravina82 podcast. ⚠️ The audio is NOT hosted here: `file`
// is the remote mp3 URL the browser streams directly.
@Entity()
export class Episode {
  // ⚠️ Public identifier: `/episode/<id>-<slug>` is a shareable URL, so the ids
  // are kept as they are. Emitted as `serial` precisely so an explicit
  // `insert ... (id, ...)` needs no `overriding system value`.
  @PrimaryKey()
  id!: number;

  @Index()
  @Property({ length: 255 })
  title!: string;

  // Cover image URL. The RSS feed has no per-entry image, so ingestion falls
  // back to the channel image — see the backend AGENTS.md, "Ingestion".
  @Property({ length: 255 })
  cover!: string;

  // The remote mp3 URL (the feed's `enclosure/@url`).
  @Property({ length: 255 })
  file!: string;

  // The episode's page on gravina82.com. Doubles as the ingestion dedup key,
  // which is why it stays even though nothing renders it.
  @Property({ length: 255 })
  originalUrl!: string;

  // Publish date. `timestamptz`, stored and read as UTC.
  @Property({ columnType: 'timestamptz' })
  date!: Date;

  // Episode length in SECONDS, from the feed's `itunes:duration`. The
  // frontend would otherwise have to discover how long an episode is by loading
  // the whole mp3 in the clip editor.
  //
  // ⚠️ Nullable, and it has to stay that way. Some rows have no duration at all, and
  // feed entries often omit the tag — so "unknown"
  // is a permanent state, not a transitional one. Ingestion
  // BACKFILLS it when a row has none and the feed does; it never overwrites a
  // value that is already there.
  @Property({ nullable: true })
  duration?: number;

  // Waveform peaks: one unsigned byte per `1 / WAVEFORM_POINTS_PER_SECOND`
  // seconds of audio, the whole episode, computed offline by
  // `src/waveform/` from the downloaded mp3 — see that module's AGENTS.md
  // section for the format. Never the full episode's worth reaches the
  // browser: `GET /episodes/:id/waveform` slices and resamples server-side.
  //
  // ⚠️ Nullable and `lazy` for the same reason as `duration`: a freshly
  // ingested episode has none until the waveform job reaches it, and every
  // ordinary `find(Episode)` (including the download script's) must not drag
  // ~70 KB per row along for nothing.
  //
  // ⚠️ Nothing wipes this column: `gravindex-db` — the database this value
  // lives in — is never truncated or reloaded by anything in this repo
  // (see the root AGENTS.md, "Running it"). It IS included in `npm run
  // db:export`'s snapshot once computed, since that dumps every column of
  // `episode` verbatim — see `packages/backend/AGENTS.md`, "Waveforms", for the
  // size consequence of that. The disposable `gravindex-test-db` that
  // `npm run test:db:seed` reloads is a different database entirely and has no
  // bearing on this one.
  @ApiHideProperty()
  @Property({ columnType: 'bytea', nullable: true, lazy: true })
  waveform?: Buffer;

  // ⚠️ `lazy`: never selected, never serialized, unless a query explicitly
  // populates it. It is not surfaced in the UI and nothing should start doing so
  // by accident.
  @ApiHideProperty()
  @Property({ columnType: 'text', lazy: true })
  description!: string;

  @ApiProperty({ type: () => [Clip] })
  @OneToMany({ entity: () => Clip, mappedBy: (clip) => clip.episode })
  clips = new Collection<Clip>(this);
}
