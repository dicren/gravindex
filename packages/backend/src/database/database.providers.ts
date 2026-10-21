import { MikroOrmModule } from '@mikro-orm/nestjs';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { buildMikroOrmOptions } from '../mikro-orm.config';

// ⚠️ `driver` is repeated here on top of the `defineConfig` in the factory, and
// it is not idle duplication: in v7 `MikroOrmCoreModule.forRootAsync` calls
// `useFactory()` as soon as the module is defined, purely to sniff which driver
// to load. Declaring it here spares that sniff — otherwise the factory runs
// twice, the first time too early.
export const databaseProviders = [
  MikroOrmModule.forRootAsync({
    driver: PostgreSqlDriver,
    useFactory: () => buildMikroOrmOptions(),
  }),
];
