import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '../config/config.module';
import { ConfigService } from '../config/config.service';

export const databaseProviders = [
  TypeOrmModule.forRootAsync({
    imports: [ConfigModule],
    inject: [ConfigService],
    useFactory: async (config: ConfigService) => ({
      type: 'mysql' as 'mysql',
      host: config.get('DB_ORM_HOST'),
      port: parseInt(config.get('DB_ORM_PORT') || '3306', 10),
      username: config.get('DB_ORM_USER'),
      password: config.get('DB_ORM_PASS'),
      database: config.get('DB_ORM_DB'),
      extra: {
        charset: 'utf8_general_ci',
      },
      entities: [__dirname + '/entities/**/*{.ts,.js}'],
      synchronize: true,
    }),
  }),
];
