import { Entity, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { ApiHideProperty } from '@nestjs/swagger';
import { Clip } from './Clip.entity';

// Append-only play counter: one row per `POST /clips/:id/play`. Nothing in the
// app reads it back yet.
//
// ⚠️ NO identity column at all — not an IP, not a token. This is the one table
// where the replacement for identity is "nothing", not "a token".
@Entity()
export class Playback {
  @PrimaryKey()
  id!: number;

  // Postgres does not index a foreign key on its own; this one is the grouping
  // column of every play count that will ever be asked for.
  @Index()
  @ManyToOne({ entity: () => Clip, updateRule: 'cascade', deleteRule: 'restrict' })
  clip!: Clip;

  // `lazy`: never selected unless a query asks for it.
  @ApiHideProperty()
  @Property({ columnType: 'timestamptz', lazy: true, defaultRaw: 'now()' })
  createdAt: Date = new Date();
}
