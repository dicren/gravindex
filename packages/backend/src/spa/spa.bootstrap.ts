import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { resolveSpaDistDir } from './spa.config';
import { SpaFallback } from './spa.middleware';

const logger = new Logger('Spa');

/**
 * Mount the built SPA: its hashed assets first, then the `index.html` fallback
 * that makes history-mode deep links work.
 *
 * ⚠️ Called from `main.ts` — and from the tests, so the two cannot drift —
 * rather than from `SpaModule`, because both halves have to be registered on the
 * Express adapter to escape `setGlobalPrefix`. See `spa.middleware.ts` for the
 * full reason.
 *
 * Order is the whole design: a real file wins over the shell, the shell wins
 * over a 404, and `/api` never reaches either.
 */
export function registerSpa(app: NestExpressApplication, config: ConfigService): void {
  const dir = resolveSpaDistDir(config);

  if (!existsSync(dir)) {
    // Not a failure: the frontend build is a separate artefact. Mounted anyway,
    // so that a build appearing next to a running API starts being served
    // without a restart — `express.static` on a missing root just falls through.
    logger.warn(`No SPA build directory at ${dir} — serving the API only`);
  }

  // ⚠️ `index: false` is load-bearing. Without it Express answers `/` with the
  // raw `index.html`, generic meta tags and all, bypassing the injection for the
  // one path most likely to be shared.
  //
  // `redirect: false` keeps a directory-shaped request (`/episode`) falling
  // through to the SPA instead of 301-ing to a trailing slash.
  app.useStaticAssets(dir, { index: false, redirect: false });

  app.use(app.get(SpaFallback).handler());
}
