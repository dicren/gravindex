import { Migration } from '@mikro-orm/migrations';

/**
 * The `user` table — the admin surface's account store, and the only
 * authentication data this system has ever had.
 *
 * Kept apart from the schema baseline on purpose: the baseline is the five
 * content tables, and this one is the single addition to them, so it arrives as
 * its own step.
 *
 * ⚠️ **It creates no rows.** There is no seed, no CLI and no bootstrap INSERT
 * here: the first admin is inserted BY HAND (root CLAUDE.md, "Settled
 * implementation details"), which means the statement has to carry an
 * already-hashed password — a plaintext one fails `bcrypt.compare` and the
 * login answers the same 401 it gives an unknown username, silently and
 * confusingly. Produce the hash with:
 *
 *     npm run build && npm run hash-password -- 'the password'
 *
 * then, from `npm run db:psql` at the repo root:
 *
 *     insert into "user" (username, password_hash) values ('admin', '$2b$10$…');
 *
 * ⚠️ **The quotes around `user` are mandatory**, in that INSERT and everywhere
 * else: `user` is a reserved word in Postgres and an unquoted one resolves to
 * the `current_user` function. MikroORM quotes every identifier it emits, so
 * only hand-written SQL has to remember.
 *
 * ⚠️ `password_hash` is a bcrypt digest (60 chars today, cost 10). The column
 * is 255 so a future algorithm change is not a schema change; bcrypt reads the
 * cost out of the digest itself, so raising it never invalidates a stored row.
 * Nothing else about a user is stored — no email, no last-login, no IP. This
 * database was designed to hold zero personal data and an admin account is not
 * the place to start.
 */
export class Migration20260816015549 extends Migration {
  override name = 'Migration20260816015549';

  override up(): void | Promise<void> {
    this.addSql(
      `create table "user" ("id" serial primary key, "username" varchar(100) not null, "password_hash" varchar(255) not null, "created_at" timestamptz not null default now());`,
    );
    // The login handle, and the unique index the login query runs on.
    this.addSql(`alter table "user" add constraint "user_username_unique" unique ("username");`);
  }

  // ⚠️ Unlike the baseline — which refuses to revert, because it stands over
  // clips and votes contributed by listeners — this one really does drop its
  // table. What it destroys is admin accounts, which are created by a
  // hand-written INSERT in the first place and cost one command to recreate.
  // Nothing a user of the site ever wrote lives here.
  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "user" cascade;`);
  }
}
