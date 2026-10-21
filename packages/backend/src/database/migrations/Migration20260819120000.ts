import { Migration } from '@mikro-orm/migrations';

/**
 * `episode.waveform` — the measured audio waveform, computed offline from the
 * downloaded mp3 (`src/waveform/`) rather than derived from anything already
 * in this database.
 *
 * ⚠️ **Nullable, for the same reason `duration` is.** Nothing populates this
 * column at insert time: `IngestService.ingestXml` knows nothing about audio
 * analysis, so a freshly ingested episode has `waveform = null` until the
 * waveform job — chained after ingestion, or run by hand — reaches it. "Not
 * measured yet" is a normal state, not a transitional one, exactly like an
 * episode whose `itunes:duration` the feed omitted.
 *
 * ⚠️ **Nothing truncates the database this column actually matters in.**
 * `gravindex-db` — where the running app writes a waveform once computed — is
 * never reset or reloaded by anything in this repository (root AGENTS.md,
 * "Running it"), so once a row is measured it stays measured. The disposable
 * `gravindex-test-db` is loaded from a fixture with no waveforms of its own and
 * has no bearing on production data.
 *
 * `bytea`, not a per-row length limit: an episode can run over two hours, and
 * at `WAVEFORM_POINTS_PER_SECOND` bytes/second that is still well under
 * Postgres' TOASTed value ceiling. No index: nothing filters or sorts by it
 * except `waveform is null` in a `where`, and at ~600 rows a scan is free,
 * same call as `episode.duration`.
 */
export class Migration20260819120000 extends Migration {
  override name = 'Migration20260819120000';

  override up(): void | Promise<void> {
    this.addSql(`alter table "episode" add column "waveform" bytea null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "episode" drop column "waveform";`);
  }
}
