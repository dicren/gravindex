import { DocumentBuilder } from '@nestjs/swagger';
import { APP_VERSION } from './constants/version';

// ⚠️ ONE builder, used by both `main.ts` (which serves the docs) and
// `scripts/generate-openapi.ts` (which writes `openapi.json` to disk). The
// frontend's whole HTTP client is generated from that file, so a document that
// differs between the two would be a contract that lies about itself.
export const API_PREFIX = 'api';

export function buildOpenApiDocumentConfig() {
  return (
    new DocumentBuilder()
      .setTitle('Gravindex API')
      .setDescription('Índice gravinero — clips, episodes and tags of the gravina82 podcast')
      .setVersion(APP_VERSION)
      // The admin surface is the only authenticated one. Declared here so the
      // generated client knows the scheme exists from the start.
      .addBearerAuth()
      .build()
  );
}
