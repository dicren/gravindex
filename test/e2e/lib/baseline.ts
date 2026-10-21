import { resolve } from 'node:path';
import { REPO_ROOT } from './constants';

/** Where the setup leaves the pristine row counts and sequence values for the
 *  teardown to compare against. Under the Playwright output directory, which is
 *  scratch space and is not committed. */
export const BASELINE_FILE = resolve(REPO_ROOT, 'test/e2e/.artifacts/db-baseline.json');

export interface Baseline {
  counts: Record<string, number>;
  sequences: Record<string, number>;
}
