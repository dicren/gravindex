import { Collection } from '@mikro-orm/core';
import {
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';
import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { Episode } from './Episode.entity';
import { Playback } from './Playback.entity';
import { Tag } from './Tag.entity';
import { Vote } from './Vote.entity';

// A clip is just `(episode, start, end, title)` — there is no audio file of its
// own anywhere. The browser streams the episode's remote mp3 and stops at `end`.
@Entity()
export class Clip {
  // ⚠️ THE public identifier: `https://indice.gravina82.com/<id>` is the
  // permalink people have been sharing since 2019. The ids are kept as they are,
  // including the two gaps left by clips deleted by hand, which must keep 404ing.
  @PrimaryKey()
  id!: number;

  @Index()
  @Property({ length: 255 })
  title!: string;

  // ⚠️ Seconds, integer. Both of them. Not milliseconds, not a duration.
  @Property()
  start!: number;

  // ⚠️ `end` is a reserved word in SQL: every hand-written statement touching
  // this column must quote it (`"end"`). MikroORM quotes identifiers on its own.
  @Property()
  end!: number;

  // ⚠️ Postgres does NOT index a foreign key on its own. Explicit, because the
  // episode detail page reads a whole episode's clips through it.
  @Index()
  @ManyToOne({ entity: () => Episode, updateRule: 'cascade', deleteRule: 'restrict' })
  episode!: Episode;

  // The anonymous voter token (a UUID the client keeps in `localStorage`). It
  // is not the visitor's IP address. ⚠️ Nullable, and because it is
  // client-supplied it is a moderation trail, never proof of identity. See root
  // AGENTS.md, "Identity".
  @ApiHideProperty()
  @Property({ length: 36, nullable: true, hidden: true })
  token?: string | null;

  // ⚠️ `lazy` keeps it out of every ordinary select. Ordering by it still works
  // (`order=clip.createdAt` is one of the values the UI sends): SQL can ORDER BY
  // a column it does not select.
  @ApiHideProperty()
  @Property({ columnType: 'timestamptz', lazy: true, defaultRaw: 'now()' })
  createdAt: Date = new Date();

  @ApiProperty({ type: () => [Vote] })
  @OneToMany({ entity: () => Vote, mappedBy: (vote) => vote.clip })
  votes = new Collection<Vote>(this);

  @ApiProperty({ type: () => [Playback] })
  @OneToMany({ entity: () => Playback, mappedBy: (playback) => playback.clip })
  playbacks = new Collection<Playback>(this);

  @ApiProperty({ type: () => [Tag] })
  @OneToMany({ entity: () => Tag, mappedBy: (tag) => tag.clip })
  tags = new Collection<Tag>(this);

  // ⚠️ `up` / `down` / `points` are deliberately NOT here. They are aggregated
  // from the `vote` table at read time, so they are not columns. They belong in a response DTO now — their
  // presence on the list and their ABSENCE on `GET /clips/:id` is a frontend
  // contract (root AGENTS.md, "Vote counts are not a column").
}
