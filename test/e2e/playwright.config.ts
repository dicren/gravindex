// The behaviour e2e suite.
//
// This suite proves what only a browser can see — the debounce, the remembered
// page size, the URL sync,
// playback, the editor's three-handle timeline, and the meta tags a crawler
// receives.
//
// ⚠️ **One worker, no parallelism, and no retries.** All of it is deliberate:
//
//   - The suite writes to the ONE database the whole machine shares, and the
//     suite asserts exact row counts against it. Two workers voting
//     on the same clip at the same time would be asserting each other's rows.
//   - Retries hide flakiness, and a flaky e2e suite is worse than none: it
//     teaches everyone to re-run instead of to read. If something here is
//     unstable, that is a finding to report, not a number to raise.

import { defineConfig, devices } from '@playwright/test';
import { APP_URL, REPO_ROOT } from './lib/constants';

export default defineConfig({
  testDir: './specs',
  outputDir: './.artifacts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  // The editor group waits for a real audio stream to report `canplay`, and the
  // ingestion group runs a Nest CLI against a database it creates first.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],

  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',

  use: {
    baseURL: APP_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // A fixed, ordinary desktop viewport: `GravPagination` picks how many page
    // buttons to draw from Vuetify's `mobile` breakpoint, and the editor hides
    // its ±10 controls below 768 px.
    viewport: { width: 1440, height: 900 },
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // ⚠️ These run against `npm run test:backend`/`test:frontend`, NOT the usual
  // `npm run dev` — deliberately on ports (3001/5174) a normal dev loop never
  // binds, pointed at the disposable `gravindex-test-db` instead of the main
  // database. `reuseExistingServer` is still safe with that in place: the only
  // thing it can now reuse is an already-running instance of THIS suite's own
  // dedicated backend/frontend, never someone's regular main-db-connected dev
  // server. Neither command is started with `CI` set, so a cold CI machine
  // starts them and a warm laptop does not.
  webServer: [
    {
      command: 'npm run test:backend',
      cwd: REPO_ROOT,
      url: 'http://localhost:3001/api/tags',
      reuseExistingServer: true,
      timeout: 180_000,
      stdout: 'ignore',
    },
    {
      command: 'npm run test:frontend',
      cwd: REPO_ROOT,
      url: APP_URL,
      reuseExistingServer: true,
      timeout: 180_000,
      stdout: 'ignore',
    },
  ],
});
