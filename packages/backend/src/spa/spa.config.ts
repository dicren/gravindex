import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isAbsolute, resolve } from 'node:path';

// Where the built SPA lives and what public origin it is served under. Both are
// config, not constants, because the two consumers disagree: local dev runs the
// backend from `packages/backend/` with the frontend built next door, while the
// container copies the build wherever its image puts it.

const logger = new Logger('Spa');

/**
 * Absolute path of the directory holding the built SPA (`index.html` plus its
 * hashed assets).
 *
 * ⚠️ The frontend build is a separate artefact, so nothing here may assume the
 * directory is present. Its absence is a logged warning and an API that keeps
 * working, never a boot failure.
 *
 * `SPA_DIST_PATH` may be absolute or relative to the process CWD, which for
 * `npm run -w packages/backend <script>` is this package's directory.
 */
export function resolveSpaDistDir(config: ConfigService): string {
  const configured = config.get<string>('SPA_DIST_PATH')?.trim();

  if (configured) {
    return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
  }

  return resolve(process.cwd(), '../frontend/dist');
}

/**
 * The absolute public origin, with any trailing slash removed.
 *
 * ⚠️ `og:url` MUST be absolute — every crawler ignores a relative one — and it
 * cannot be derived from the request: behind a proxy the `Host` header is
 * whatever reached the last hop. Hence a configured value.
 */
export function resolvePublicUrl(config: ConfigService): string {
  const configured = config.get<string>('PUBLIC_URL')?.trim();

  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  // A wrong-but-absolute origin still produces a parseable document; a missing
  // one produces meta tags that silently do nothing. Say so once, loudly.
  const port = config.get<string>('SERVER_PORT') ?? '3000';
  const fallback = `http://localhost:${port}`;
  logger.warn(`PUBLIC_URL is not set — social previews will claim to live at ${fallback}`);

  return fallback;
}
