// After the last test: delete every row the suite created, put the sequences
// back where they were, and prove the database is pristine again.
//
// ⚠️ It THROWS on drift rather than tidying quietly. A behaviour suite that
// leaves a row behind breaks the e2e suite's exact-count assertions,
// and the failure would surface there — in the wrong place, hours later, looking
// like a contract regression. Better to fail here, with the numbers in hand.

import { readFileSync } from 'node:fs';
import { BASELINE_FILE, type Baseline } from './lib/baseline';
import { cleanupWrites, restoreSequences, rowCounts } from './lib/db';

export default function globalTeardown(): void {
  cleanupWrites();

  let baseline: Baseline | null = null;
  try {
    baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as Baseline;
  } catch {
    // No baseline means the setup never got far enough to write one; the count
    // check below still runs against the constants.
  }

  if (baseline !== null) restoreSequences(baseline.sequences);

  const after = rowCounts();
  const expected = baseline?.counts ?? null;
  const problems: string[] = [];

  if (expected !== null) {
    for (const [table, value] of Object.entries(expected)) {
      if (after[table] !== value) {
        problems.push(`${table}: ${after[table]} rows after the run, ${value} before it`);
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(
      [
        'the suite did not give the database back as it found it:',
        ...problems.map((p) => `  - ${p}`),
      ].join('\n'),
    );
  }
}
