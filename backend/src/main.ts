import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  if (app.get('ConfigService').get('CORS')) {
    app.enableCors();
  }
  app.use(cookieParser());
  await app.listen(app.get('ConfigService').get('SERVER_PORT'));
}
bootstrap();
