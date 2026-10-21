import { Migration } from '@mikro-orm/migrations';

/**
 * `episode.duration` — the one column RSS ingestion adds to the baseline
 * schema, in seconds, from the feed's `itunes:duration`.
 *
 * ⚠️ **Nullable on purpose, permanently.** Two independent reasons, and either
 * one alone would be enough:
 *
 *   - some episodes have no duration anywhere to take one from;
 *   - feed entries often ship no `<itunes:duration>` tag, so even a fully
 *     re-ingested catalogue has holes.
 *
 * "Unknown length" is therefore a normal state a consumer has to handle, not a
 * gap that a later backfill closes. Ingestion fills the column in when a row
 * has none and the feed offers one, and never overwrites a value already
 * there.
 *
 * No index: nothing sorts or filters by it, and at ~600 rows a scan is free.
 */
export class Migration20260816120000 extends Migration {
  override name = 'Migration20260816120000';

  override up(): void | Promise<void> {
    this.addSql(`alter table "episode" add column "duration" int null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "episode" drop column "duration";`);
  }
}
