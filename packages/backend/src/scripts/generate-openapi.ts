import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../app.module';
import { API_PREFIX, buildOpenApiDocumentConfig } from '../openapi';

// Writes `openapi.json` to disk. ⚠️ **This is the most schedule-critical
// artifact in the project**: the frontend's HTTP client is generated from it
// (`@hey-api/openapi-ts`), so it must be producible early, repeatedly, and by
// anyone.
//
// Two properties are deliberate and must survive any rewrite of this file:
//
//   - **No database.** `preview: true` makes Nest walk the controller metadata
//     without instantiating a single provider, so nothing connects to postgres
//     and no migration runs. `npm run openapi` works on a laptop with docker
//     stopped.
//   - **No listening server.** The document is built from an application
//     context that is closed again; nothing binds a port, so this is safe in
//     CI and safe to run twice at once.
//
// ⚠️ It runs from `dist/`, not from source, and that is not a detail: the
// `@nestjs/swagger` CLI plugin (see `nest-cli.json`) is what fills in every DTO
// property schema, and it only runs inside `nest build`. Executed straight from
// TypeScript, every schema would come out as `{}`. Hence
// `"openapi": "nest build && node dist/scripts/generate-openapi.js"`.
async function generate(): Promise<void> {
  const app = await NestFactory.create(AppModule, { preview: true, logger: false });
  app.setGlobalPrefix(API_PREFIX);

  const document = SwaggerModule.createDocument(app, buildOpenApiDocumentConfig());

  const outPath = path.resolve(process.argv[2] ?? 'openapi.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`wrote ${outPath}`);

  await app.close();
}

void generate();
