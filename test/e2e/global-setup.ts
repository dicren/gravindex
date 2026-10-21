// Before a single test runs: prove the database is the pristine fixture,
// and write down the sequence values so the teardown can put them back.
//
// ⚠️ This guard exists because a stray row was caught here once. Reads are only
// meaningful against
// untouched data, and a behaviour suite that WRITES has to be able to prove it
// gave everything back.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { BASELINE_FILE } from './lib/baseline';
import { captureSequences, cleanupWrites, driftFromPristine, rowCounts } from './lib/db';

export default function globalSetup(): void {
  // A crashed previous run could have left rows behind. Clearing them FIRST and
  // then asserting is the difference between "this suite is not reusable" and
  // "this suite always starts from a known state".
  cleanupWrites();

  const drift = driftFromPristine();
  if (drift.length > 0) {
    throw new Error(
      [
        'the database is not the pristine fixture, so nothing this suite',
        'asserts would mean anything. Reload it with `npm run test:db:reset`.',
        ...drift.map((line) => `  - ${line}`),
      ].join('\n'),
    );
  }

  const baseline = { counts: rowCounts(), sequences: captureSequences() };
  mkdirSync(dirname(BASELINE_FILE), { recursive: true });
  writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2));
}
