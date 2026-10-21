import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { buildMikroOrmOptions } from './mikro-orm.config';

// ⚠️ This file exists because of a bug that never looked like a database bug.
//
// The config used to pick its entity glob off `NODE_ENV`: `./database/entities`
// when production, `./dist/database/entities` otherwise. Both are relative, and
// MikroORM resolves relative paths against `baseDir`, which defaults to the
// process's working directory — so the production branch was only correct for a
// process running with `dist/` as its CWD. Setting the flag then broke other
// tools that load the same config, and leaving it unset silently turned off the
// SPA shell cache in `SpaService`, which re-read `index.html` on every request.
//
// So: no path in this config may depend on the working directory, and none may
// depend on `NODE_ENV`. Those are the two claims below.

const PACKAGE_ROOT = resolve(__dirname, '..');

function packageName(root: string): string {
  const manifest: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

  return manifest !== null && typeof manifest === 'object' && 'name' in manifest
    ? String(manifest.name)
    : '';
}

/** Narrow away the `| undefined` these options carry, loudly rather than by cast. */
function required(value: string | undefined, what: string): string {
  if (value === undefined) {
    throw new Error(`the MikroORM configuration must set ${what}`);
  }

  return value;
}

describe('the MikroORM configuration', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('anchors itself to the package, not to the working directory', () => {
    const baseDir = required(buildMikroOrmOptions().baseDir, 'baseDir');

    expect(isAbsolute(baseDir)).toBe(true);
    // It really is this package's root, whatever the CWD happens to be.
    expect(packageName(baseDir)).toBe('@gravindex/backend');
  });

  it('resolves the entity glob and the migrations inside that package', () => {
    const options = buildMikroOrmOptions();
    const base = required(options.baseDir, 'baseDir');
    const globs = (options.entities ?? []).filter((entry) => typeof entry === 'string');

    expect(globs.length).toBeGreaterThan(0);
    for (const glob of globs) {
      expect(resolve(base, glob).startsWith(join(PACKAGE_ROOT, 'dist'))).toBe(true);
    }

    expect(resolve(base, required(options.migrations?.path, 'migrations.path'))).toBe(
      join(PACKAGE_ROOT, 'dist', 'database', 'migrations'),
    );
    // ⚠️ `pathTs` is where the CLI EMITS a new migration, so it must land in the
    // sources that get committed — never in a build directory.
    expect(resolve(base, required(options.migrations?.pathTs, 'migrations.pathTs'))).toBe(
      join(PACKAGE_ROOT, 'src', 'database', 'migrations'),
    );
  });

  it('reads the same paths whether or not NODE_ENV is production', () => {
    // ⚠️ The regression test. `NODE_ENV=production` must be safe to set: the
    // server needs it (it is what makes `SpaService` cache the SPA shell instead
    // of re-reading `index.html` per request), and every other tool that loads
    // this config must survive it.
    process.env.NODE_ENV = 'production';
    const prod = buildMikroOrmOptions();

    process.env.NODE_ENV = 'dev';
    const dev = buildMikroOrmOptions();

    expect(prod.entities).toEqual(dev.entities);
    expect(prod.baseDir).toBe(dev.baseDir);
    expect(prod.migrations?.path).toBe(dev.migrations?.path);
    expect(prod.migrations?.pathTs).toBe(dev.migrations?.pathTs);
  });
});
