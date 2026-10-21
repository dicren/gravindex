import { defineConfig } from '@hey-api/openapi-ts';

// The HTTP client is GENERATED from the backend's published contract — run
// `npm run generate:api` (regenerate the contract first with
// `npm run openapi -w packages/backend` if the API changed).
//
// ⚠️ The point of this file is that **no endpoint path is ever written by
// hand** in this package. The alternative, typing URLs inline in the components, is what
// this replaces.
//
// The output is COMMITTED, for the same reason `packages/backend/openapi.json`
// is: a backend contract change then shows up as a reviewable diff on this
// side, and `npm install && npm run build` works without a generation step
// (which would otherwise need the backend built first, since `openapi.json`
// comes out of a Nest bootstrap).
//
// ⚠️ Nothing outside `core/infrastructure/` may import from `generated/` — the
// lint boundaries enforce that. Repositories map the generated DTOs to domain
// entities; the rest of the app only ever sees entities.
export default defineConfig({
  input: '../backend/openapi.json',
  output: {
    path: 'src/core/infrastructure/generated',
    // Prettier ignores this folder (see the root `.prettierignore`), so ask the
    // generator to keep the output tidy on its own — otherwise the committed
    // diff churns on formatting alone.
    postProcess: ['prettier'],
  },
  plugins: [
    '@hey-api/typescript',
    {
      name: '@hey-api/client-fetch',
      // Base URL and transport are decided at runtime, not baked in here — see
      // the file itself. A generated absolute URL would bake the API base
      // into the build.
      runtimeConfigPath: './src/core/infrastructure/http/api-client.config.ts',
    },
    '@hey-api/sdk',
  ],
});
