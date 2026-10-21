import { Entity, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';
import { ApiHideProperty } from '@nestjs/swagger';
import { Clip } from './Clip.entity';

// One row per vote. `value` is `+1`; nothing else is accepted — see
// `api/clips/dto/clip-params.dto.ts`.
//
// ⚠️ The uniqueness rule lives in the SCHEMA, not in a read-then-write in the
// service: a read-then-write is a race, two concurrent votes both finding no
// previous row.
// Postgres does not collide NULLs in a unique constraint, so rows without a
// token (all `token = null`) are fine and the dedup applies only to votes that
// carry one. That is intended — see root AGENTS.md, "Identity".
@Entity()
@Unique({ properties: ['clip', 'token'] })
export class Vote {
  @PrimaryKey()
  id!: number;

  // ⚠️ No separate `@Index()` here, unlike the other two foreign keys: the
  // unique constraint below already builds a btree on `(clip_id, token)`, whose
  // LEADING column is `clip_id`. A second index would be dead weight.
  @ManyToOne({ entity: () => Clip, updateRule: 'cascade', deleteRule: 'restrict' })
  clip!: Clip;

  // +1 / -1.
  @Property()
  value!: number;

  // See Clip.token.
  @ApiHideProperty()
  @Property({ length: 36, nullable: true, hidden: true })
  token?: string | null;

  // `lazy`: never selected unless a query asks for it.
  @ApiHideProperty()
  @Property({ columnType: 'timestamptz', lazy: true, defaultRaw: 'now()' })
  createdAt: Date = new Date();
}
