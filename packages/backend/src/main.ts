import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { API_PREFIX, buildOpenApiDocumentConfig } from './openapi';
import { registerSpa } from './spa/spa.bootstrap';

async function bootstrap() {
  // ⚠️ Typed as `NestExpressApplication` for `useStaticAssets` — this process
  // serves the built SPA as well as the API.
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  app.setGlobalPrefix(API_PREFIX);

  // ⚠️ `contentSecurityPolicy` off: this process also serves the SPA, and
  // helmet's default CSP blocks the inline bootstrap a Vite build emits. Turning
  // it on has to be done with the real `index.html` in front of you.
  app.use(helmet({ contentSecurityPolicy: false }));

  // The built SPA: static assets, then the `index.html` fallback that injects
  // the social-preview meta tags. ⚠️ Registered on the adapter, and therefore
  // here rather than inside `SpaModule` — anything mounted through Nest's router
  // or its middleware consumer lands under the global prefix above and would
  // serve the site at `/api`. The reasoning is in `spa/spa.middleware.ts`.
  registerSpa(app, config);

  // ⚠️ Without this pipe every `class-validator` decorator in the DTOs is inert —
  // nothing checks that `start`/`end` are integers or that a title is non-empty.
  // Malformed requests get a 400 instead of succeeding.
  //   `whitelist`             strips properties with no decorator;
  //   `forbidNonWhitelisted`  makes an unknown property a 400 instead of a
  //                           silent drop, so a frontend typo is loud;
  //   `transform`             instantiates the DTO class and coerces query
  //                           params (`?page=2` is a string on the wire).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Opt-in, and it has to be on in dev: the SPA's dev server runs on another
  // port. In the target deployment the backend serves the SPA itself, so the
  // two share an origin and this stays off.
  if (config.get<string>('CORS') === 'true') {
    app.enableCors();
  }

  const document = SwaggerModule.createDocument(app, buildOpenApiDocumentConfig());
  SwaggerModule.setup(`${API_PREFIX}/docs`, app, document);

  app.enableShutdownHooks();

  const port = Number(config.get<string>('SERVER_PORT') ?? 3000);
  await app.listen(port);
}

void bootstrap();
