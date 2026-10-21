import { PrimaryKeyProp } from '@mikro-orm/core';
import { Entity, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { ApiHideProperty } from '@nestjs/swagger';
import { Clip } from './Clip.entity';

// ⚠️ There is no tag table: a tag IS the `(clip, tag)` pair, free text, with a
// COMPOSITE primary key over both. No rename, no merge, no canonical list —
// `GET /tags` is a `select distinct`. Keep it that way unless the whole model
// changes.
@Entity()
export class Tag {
  // Tuple, not a union: MikroORM reads this to type the composite key.
  [PrimaryKeyProp]?: ['clip', 'tag'];

  @ManyToOne({ entity: () => Clip, primary: true, updateRule: 'cascade', deleteRule: 'restrict' })
  clip!: Clip;

  @Index()
  @PrimaryKey({ length: 255 })
  tag!: string;

  // See Clip.token — the anonymous submitter token, not an IP address.
  @ApiHideProperty()
  @Property({ length: 36, nullable: true, hidden: true })
  token?: string | null;

  // `lazy`: never selected unless a query asks for it.
  @ApiHideProperty()
  @Property({ columnType: 'timestamptz', lazy: true, defaultRaw: 'now()' })
  createdAt: Date = new Date();
}
