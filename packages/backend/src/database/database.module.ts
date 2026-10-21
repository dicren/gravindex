import { MikroORM } from '@mikro-orm/core';
import { Module, OnModuleInit } from '@nestjs/common';
import { databaseProviders } from './database.providers';

// ⚠️ This module exports nothing on purpose. `forRootAsync` delegates to
// `MikroOrmCoreModule`, which is `@Global()` and already exports `MikroORM`,
// `EntityManager` and the driver class to the whole application. (Re-exporting
// is also impossible in v7: `forRootAsync` returns a `MaybePromise<DynamicModule>`
// and Nest accepts a promise in `imports` but not in `exports`.)
//
// A failure here is an INJECTION failure, at boot, and no unit suite would see
// it — they all mock their repositories. It is verified by booting the app
// against a real database.
@Module({
  imports: [...databaseProviders],
})
export class DatabaseModule implements OnModuleInit {
  constructor(private readonly orm: MikroORM) {}

  // Applies pending migrations on every boot, in every environment.
  // ⚠️ `synchronize` stays off: schema changes go through
  // `npm run migration:create`, never through entity auto-sync. Synchronising
  // the schema from the entities would make every entity rename a silent data
  // loss.
  async onModuleInit(): Promise<void> {
    // `orm.getMigrator()` became a property in v7.
    await this.orm.migrator.up();
  }
}
