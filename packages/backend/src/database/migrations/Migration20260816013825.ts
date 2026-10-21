import { Migration } from '@mikro-orm/migrations';

/**
 * The schema baseline: the five content tables. Everything below is generated from
 * the entities except the
 * `unaccent` extension, the `down()` and the comments.
 *
 * ⚠️ **`synchronize` stays off.** Rebuilding the schema from the entities on
 * every boot turns every rename into a silent data loss. Schema changes go
 * through `npm run migration:create` (and `npm run build` first — the CLI reads
 * the compiled entities).
 *
 * Three decisions worth reading before touching this file:
 *
 * 1. **The primary keys are `serial`, not `generated always as identity`.**
 *    Clip ids are PUBLIC URLS (`https://indice.gravina82.com/<id>`), and episode
 *    ids ride inside `/episode/<id>-<slug>`, so the ids are kept verbatim — gaps
 *    included: ids 175 and 176 no longer exist and must keep 404ing. With `serial` an explicit
 *    `insert into clip (id, ...)` just works; `identity` would need
 *    `overriding system value` on every statement. After inserting explicit ids,
 *    each sequence has to be caught up or the first new row collides with one of
 *    them:
 *
 *        select setval(pg_get_serial_sequence('clip', 'id'), max(id)) from clip;
 *
 *    ...and the same for `episode`, `vote` and `playback`. `tag` has no
 *    sequence: its key is the `(clip, tag)` pair.
 *
 * 2. **`token` is nullable everywhere it exists, and that is intended.** It is
 *    the anonymous per-browser UUID that stands in for identity, and it is not
 *    the visitor's IP address (root AGENTS.md, "Identity"). Postgres does not
 *    collide NULLs in a unique constraint, so a row without a token never blocks
 *    the dedup, which binds only the votes that carry one. The cost is that
 *    losing the token allows one more vote: noise, and the price of a database
 *    with no personal data in it. ⚠️ `playback` has no identity column AT ALL,
 *    on purpose.
 *
 * 3. **Timestamps are `timestamptz` and everything in them is UTC.** `created_at`
 *    defaults to `now()`, so a hand-written INSERT — the admin bootstrap, a
 *    fixture, a `psql` session — does not have to set it.
 */
export class Migration20260816013825 extends Migration {
  override name = 'Migration20260816013825';

  override up(): void | Promise<void> {
    // Accent-insensitive search: the queries use `unaccent()`, so the extension has
    // to exist before they do.
    //
    // ⚠️ **There is deliberately NO functional index over it.** Two reasons,
    // and the second is the decisive one:
    //   - `unaccent()` is STABLE, not IMMUTABLE (its dictionary can be
    //     reloaded), so indexing it needs a wrapper function that lies about
    //     the volatility of what it calls;
    //   - the search this app performs is `LIKE '%term%'`, with a LEADING
    //     wildcard, which **no btree index can serve** however it is expressed.
    //     Only a `pg_trgm` GIN index could, and at 395 episodes / 180 clips /
    //     ~380 tag rows a sequential scan is invisible to the user.
    // Correct results beat a clever index here. Revisit if the catalogue ever
    // grows by two orders of magnitude — RSS ingestion adds ~79 episodes, not
    // 40 000.
    this.addSql(`create extension if not exists unaccent;`);

    this.addSql(
      `create table "episode" ("id" serial primary key, "title" varchar(255) not null, "cover" varchar(255) not null, "file" varchar(255) not null, "original_url" varchar(255) not null, "date" timestamptz not null, "description" text not null);`,
    );
    // Besides the primary and foreign keys, one index: every episode search would
    // otherwise be a full scan. Free to add while creating the tables.
    this.addSql(`create index "episode_title_index" on "episode" ("title");`);

    this.addSql(
      `create table "clip" ("id" serial primary key, "title" varchar(255) not null, "start" int not null, "end" int not null, "episode_id" int not null, "token" varchar(36) null, "created_at" timestamptz not null default now());`,
    );
    this.addSql(`create index "clip_title_index" on "clip" ("title");`);
    this.addSql(`create index "clip_episode_id_index" on "clip" ("episode_id");`);

    this.addSql(
      `create table "playback" ("id" serial primary key, "clip_id" int not null, "created_at" timestamptz not null default now());`,
    );
    this.addSql(`create index "playback_clip_id_index" on "playback" ("clip_id");`);

    this.addSql(
      `create table "tag" ("clip_id" int not null, "tag" varchar(255) not null, "token" varchar(36) null, "created_at" timestamptz not null default now(), primary key ("clip_id", "tag"));`,
    );
    this.addSql(`create index "tag_tag_index" on "tag" ("tag");`);

    this.addSql(
      `create table "vote" ("id" serial primary key, "clip_id" int not null, "value" int not null, "token" varchar(36) null, "created_at" timestamptz not null default now());`,
    );
    this.addSql(
      `alter table "vote" add constraint "vote_clip_id_token_unique" unique ("clip_id", "token");`,
    );

    // ⚠️ `on delete restrict` throughout: deleting a clip is not one `DELETE`,
    // it is a transaction that clears its votes, tags and playbacks first. The
    // admin's delete has to decide that explicitly rather than discover it.
    this.addSql(
      `alter table "clip" add constraint "clip_episode_id_foreign" foreign key ("episode_id") references "episode" ("id") on update cascade on delete restrict;`,
    );

    this.addSql(
      `alter table "playback" add constraint "playback_clip_id_foreign" foreign key ("clip_id") references "clip" ("id") on update cascade on delete restrict;`,
    );

    this.addSql(
      `alter table "tag" add constraint "tag_clip_id_foreign" foreign key ("clip_id") references "clip" ("id") on update cascade on delete restrict;`,
    );

    this.addSql(
      `alter table "vote" add constraint "vote_clip_id_foreign" foreign key ("clip_id") references "clip" ("id") on update cascade on delete restrict;`,
    );
  }

  // ⚠️ Deliberately refuses instead of dropping the five tables. This database
  // holds clips, votes and tags contributed by listeners; the base class's
  // `down()` is a silent no-op, and a generated one would have been a five-table
  // `drop` reachable by a typo. ⚠️ There is no script anywhere in this repo that
  // rebuilds it from scratch, on purpose — see the root `AGENTS.md`, "Running
  // it". A deliberate `docker volume rm gravindex_db` is the only way, and it is
  // meant to be inconvenient.
  override down(): void | Promise<void> {
    throw new Error(
      'The schema baseline is not revertible. There is no script that rebuilds this database from scratch — see the root AGENTS.md, "Running it".',
    );
  }
}
