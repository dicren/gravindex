import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { defineConfig } from '@mikro-orm/postgresql';
import * as dotenv from 'dotenv';
import { resolve } from 'node:path';

// Single source of truth for the connection + migrations config, consumed both
// by the Nest runtime (`database.providers.ts`) and by the standalone
// `mikro-orm` CLI (`migration:create|up|down`, see package.json's "mikro-orm"
// key). The CLI never goes through Nest, so it has no ConfigModule to populate
// `process.env` for it — hence the dotenv preamble below.
//
// ⚠️ `override: false` (dotenv's default) is the whole point: real environment
// variables WIN over the file. In docker the values arrive from the
// environment, and under the Nest runtime `ConfigModule.forRoot` has already
// populated `process.env` by the time this runs, so this becomes a no-op.
// Mirrors `AppModule`'s `envFilePath`.
for (const envFile of [`.env.${process.env.NODE_ENV}`, '.env', '../../.env']) {
  dotenv.config({ path: envFile, override: false, quiet: true });
}

// ⚠️ Every path below hangs off THIS, and nothing hangs off the working
// directory. That is the whole point, and it was learnt the hard way: the entity
// glob used to flip on `NODE_ENV === 'production'` — `./database/…` instead of
// `./dist/database/…` — which is only correct if the process runs with `dist/` as
// its CWD. Tools that pinned `baseDir` to the package root lost their entities
// under that flag, and leaving the flag unset in turn stopped `SpaService`
// caching the SPA shell. One assumption about a working directory, several
// consequences.
//
// `__dirname` is `<package>/dist` for the compiled config — the only thing the
// runtime and the `mikro-orm` CLI ever load (see package.json's
// `mikro-orm.configPaths`) — and `<package>/src` under ts-jest. Its parent is
// the package root either way, so `npm run …` from the package, `node dist/…`
// from anywhere, and the CLI all resolve to the same files.
const PACKAGE_ROOT = resolve(__dirname, '..');

export function buildMikroOrmOptions() {
  return defineConfig({
    // Absolute, and therefore independent of however the process was launched.
    // MikroORM defaults this to `process.cwd()`; every relative path in this
    // object — the entity glob, both migration paths — is resolved against it.
    baseDir: PACKAGE_ROOT,
    // ⚠️ Not optional in v7, and its absence fails unreadably: the defaults
    // ship the abstract MetadataProvider, which reads nothing, so every
    // @Property comes out untyped and discovery dies. Before v7 this was the
    // default and lived in `@mikro-orm/core`.
    metadataProvider: ReflectMetadataProvider,
    // ⚠️ Always the COMPILED entities, never `src`. There is deliberately no
    // `entitiesTs`: with a `tsx`/esbuild loader there is no
    // `emitDecoratorMetadata` at all, so CLI discovery would fail where the
    // runtime succeeds. One path means a migration diff is computed against
    // exactly the metadata the application uses.
    //
    // ⚠️ Consequence for whoever creates a migration: `npm run build` first.
    //
    // ⚠️ ONE glob, in every environment. It reads relative but is resolved
    // against `baseDir` above, not against the CWD.
    entities: ['./dist/database/entities/**/*.js'],
    host: process.env.DB_HOST ?? 'localhost',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    dbName: process.env.DB_NAME,
    // Default `public` schema on purpose: every tool that touches the database
    // (psql, pg_restore, a `\dt`) then needs no search_path ceremony.
    allowGlobalContext: false,
    debug: false,
    // The app runs the COMPILED migrations under `path`. ⚠️ The CLI forces this
    // to `true` (CLIHelper does, unless the package.json "mikro-orm" key says
    // otherwise) and that is the trick: with `preferTs` on, the migrator EMITS
    // into `pathTs`, i.e. the `src/` folder that gets committed. Entities do not
    // follow, because `entitiesTs` is deliberately unset and discovery only
    // consults it when non-empty.
    preferTs: false,
    migrations: {
      tableName: 'mikro_orm_migrations',
      // Both relative to `baseDir`, i.e. to the package, never to the CWD.
      path: './dist/database/migrations',
      pathTs: './src/database/migrations',
      glob: '!(*.d).{js,ts}',
      transactional: true,
      disableForeignKeys: false,
      allOrNothing: true,
      emit: 'ts',
      snapshot: true,
    },
  });
}

// Consumed by the `mikro-orm` CLI (package.json "mikro-orm.configPaths").
export default buildMikroOrmOptions();
