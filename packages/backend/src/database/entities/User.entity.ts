import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';

// The admin account table — the one addition to the content tables (root
// CLAUDE.md, "The API contract"). Without it an ugly cut or an abusive tag can
// only be removed with hand-written SQL; this is the identity behind the
// endpoints that exist instead.
//
// ⚠️ It has nothing to do with the anonymous voter token. That token is a
// client-generated UUID sent on public writes for deduplication, it is
// spoofable, and NOTHING in the admin surface may read it. A `User` row is the
// only credential in this system.
//
// ⚠️ There is no registration endpoint, no seed and no bootstrap migration:
// **the first user is inserted by hand** (root CLAUDE.md, "Settled
// implementation details"), which is why `passwordHash` is what the column
// holds and why `npm run hash-password` exists. A row carrying a plaintext
// password simply never logs in — `bcrypt.compare` returns false and the
// endpoint answers the same 401 it gives an unknown username.
//
//     npm run build && npm run hash-password -- 'the password'
//     insert into "user" (username, password_hash) values ('admin', '$2b$10$…');
//
// (`user` is a reserved word in Postgres — the quotes above are required.)
@Entity()
export class User {
  // Has a class-level initializer AND a database default, so `em.create` must
  // not demand it. Without this the type system insists on a `createdAt` that
  // the entity is perfectly capable of supplying itself.
  [OptionalProps]?: 'createdAt';

  @PrimaryKey()
  id!: number;

  // Unique, and the login handle. Nothing else identifies an account.
  @Property({ length: 100, unique: true })
  username!: string;

  // ⚠️ `hidden: true` is the load-bearing part, NOT `@ApiHideProperty()`.
  // The decorator only removes the field from the generated OpenAPI *spec*;
  // MikroORM's `wrap(entity).toJSON()` — which runs whenever an entity is
  // returned from a controller, at any depth — would still emit the hash.
  // `hidden: true` drops the property from serialization unconditionally,
  // whatever populated it. `auth.serialization.spec.ts` asserts both halves.
  @ApiHideProperty()
  @Property({ length: 255, hidden: true })
  passwordHash!: string;

  @ApiProperty()
  @Property({ columnType: 'timestamptz', defaultRaw: 'now()' })
  createdAt: Date = new Date();
}
