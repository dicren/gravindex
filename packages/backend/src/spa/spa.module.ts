import { Module } from '@nestjs/common';
import { SpaFallback } from './spa.middleware';
import { SpaService } from './spa.service';

// ⚠️ No controllers and no `MiddlewareConsumer`: this module only PROVIDES the
// pieces, and `registerSpa()` (called from `main.ts`) mounts them on the Express
// adapter, where `setGlobalPrefix` cannot reach them. `spa.middleware.ts`
// explains why nothing else works.
//
// A side effect worth knowing: because it owns no route, its position last in
// `app.module.ts` no longer matters. Leaving it there costs nothing and keeps
// the "the SPA goes last" reflex intact for whoever reads the imports.
//
// ⚠️ No `MikroOrmModule.forFeature` either. The service reads its two entities
// through the globally-provided `EntityManager` rather than injected
// repositories, which is what lets the tests boot this module against a stub
// instead of a live Postgres. `api/clips` owns the clip queries; nothing here
// imports from it.
@Module({
  providers: [SpaService, SpaFallback],
  exports: [SpaService],
})
export class SpaModule {}
