import { EntityManager } from '@mikro-orm/postgresql';
import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpaService } from './spa.service';

// ⚠️ The cache half of `SpaService`. Caching depends on `NODE_ENV=production`,
// and that flag must stay safe to set: the config is working-directory
// independent, so setting it cannot break the database side. Left unset,
// `revalidate` never turns off, and the deployed API `stat`s and re-reads
// `index.html` on every single request for a build that cannot change under a
// running process. These tests say out loud what setting the flag buys.

const SOCIAL_ROUTE = '/42';

/** `SpaService` only ever calls `fork()` and `findOne()`; nothing here has a clip. */
function emptyEntityManager(): EntityManager {
  const stub = {
    fork: () => stub,
    findOne: () => Promise.resolve(null),
  };

  return stub as unknown as EntityManager;
}

function serviceFor(distDir: string, nodeEnv: string): SpaService {
  return new SpaService(
    emptyEntityManager(),
    new ConfigService({
      SPA_DIST_PATH: distDir,
      PUBLIC_URL: 'https://indice.example.test',
      NODE_ENV: nodeEnv,
    }),
  );
}

describe('SpaService and the SPA shell cache', () => {
  let distDir: string;
  let indexPath: string;

  beforeEach(async () => {
    distDir = await mkdtemp(join(tmpdir(), 'gravindex-spa-'));
    indexPath = join(distDir, 'index.html');
    await writeFile(indexPath, '<html><head><title>primero</title></head><body></body></html>');
  });

  afterEach(async () => {
    await rm(distDir, { recursive: true, force: true });
  });

  /** Rewrite the shell with a mtime the `stat` check cannot mistake for the old one. */
  async function replaceShell(html: string): Promise<void> {
    await writeFile(indexPath, html);
    const later = new Date(Date.now() + 60_000);
    await utimes(indexPath, later, later);
  }

  it('reads index.html exactly once under NODE_ENV=production', async () => {
    const service = serviceFor(distDir, 'production');

    expect(await service.render('/')).toContain('primero');

    await replaceShell('<html><head><title>segundo</title></head><body></body></html>');

    // ⚠️ Deliberate: a deployed build never changes under a running process, so
    // the file is not consulted again — not even to `stat` it.
    expect(await service.render('/')).toContain('primero');
    expect(await service.render(SOCIAL_ROUTE)).toContain('primero');
  });

  it('still picks up a rebuild outside production, which is what dev needs', async () => {
    const service = serviceFor(distDir, 'dev');

    expect(await service.render('/')).toContain('primero');

    await replaceShell('<html><head><title>segundo</title></head><body></body></html>');

    expect(await service.render('/')).toContain('segundo');
  });

  it('keeps answering null — never throwing — when there is no build at all', async () => {
    const service = serviceFor(join(distDir, 'does-not-exist'), 'production');

    expect(await service.render('/')).toBeNull();
    // ⚠️ Absence is retried even in production: a build that appears while the
    // API is up must start being served without a restart.
    await writeFile(
      join(distDir, 'index.html'),
      '<html><head><title>x</title></head><body></body></html>',
    );
    expect(await service.render('/')).toBeNull();
  });
});
