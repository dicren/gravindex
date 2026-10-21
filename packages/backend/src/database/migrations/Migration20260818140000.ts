import { Migration } from '@mikro-orm/migrations';

/**
 * Data normalisation: only positive votes are valid, so any row holding a
 * negative value is removed.
 *
 * Every screen has a single vote button and `POST /clips/:id/vote/-1` answers
 * 400 (`VoteParamsDto`), so a `-1` row would keep subtracting from a total
 * nothing can add to — `up` and `points` would disagree on those clips forever.
 *
 * ⚠️ **`down()` is deliberately empty.** Nothing records which row carried
 * which value, so there is nothing to restore even in principle — a `down()`
 * could only invent rows. Rolling this migration back leaves the table as it is,
 * which is the honest answer.
 *
 * ⚠️ The test fixture (`test/testdb/fixture.sql`) carries no negative votes
 * either, so a re-seed cannot bring them back.
 */
export class Migration20260818140000 extends Migration {
  override name = 'Migration20260818140000';

  override up(): void | Promise<void> {
    this.addSql(`delete from "vote" where "value" = -1;`);
  }

  override down(): void | Promise<void> {
    // Intentionally empty — see the class comment. The deleted rows carried no
    // recoverable identity, so there is nothing to put back.
  }
}
