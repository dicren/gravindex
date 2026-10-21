import { Injectable } from '@nestjs/common';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { API_PREFIX } from '../openapi';
import { SpaService } from './spa.service';

// ⚠️ Express middleware mounted on the adapter, NOT a `@Controller()` and NOT a
// `MiddlewareConsumer` route. Both of those mount under `setGlobalPrefix`, which
// would put the SPA at `/api/...` and leave the site itself unreachable:
//
//   - a catch-all controller route gets the prefix like any other route;
//   - `MiddlewareConsumer.forRoutes()` gets it too — Nest 11's
//     `RouteInfoPathExtractor` turns a wildcard middleware path into
//     `['/api$', '/api/{*splat}']` when a prefix is set (verified against
//     @nestjs/core 11.2.1, and it is easy to mistake for "the middleware never
//     runs");
//   - and `setGlobalPrefix`'s `exclude` is no escape hatch, because exclusions
//     are matched as PATTERNS against every route path: one broad enough to
//     cover `/{*splat}` also covers `/health` and `/clips`, stripping the
//     prefix off the entire API.
//
// Registered on the adapter it is prefix-free, runs before the router, and
// decides for itself what it will not handle — which is one rule, written
// below: everything under `/api` belongs to Nest.

const API_PATH = `/${API_PREFIX}`;

@Injectable()
export class SpaFallback {
  constructor(private readonly spa: SpaService) {}

  /** The Express handler, ready to hand to `app.use()`. */
  handler(): RequestHandler {
    return (req, res, next) => {
      this.serve(req, res, next).catch(next);
    };
  }

  private async serve(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }

    const pathname = this.pathnameOf(req);

    // ⚠️ The API, INCLUDING the routes it does not have. An unknown `/api/...`
    // must come back as Nest's JSON 404, never as an HTML page: the frontend's
    // generated client parses JSON, and a shell served under `/api` would turn
    // every typo'd endpoint into a silent success.
    if (pathname === API_PATH || pathname.startsWith(`${API_PATH}/`)) {
      next();
      return;
    }

    // A dot in the last segment means the visitor asked for a file, and the
    // static middleware already had its chance at it. Answering `index.html`
    // here is how a missing `/assets/app.js` becomes an HTML parse error in the
    // console instead of an honest 404.
    if (this.looksLikeAsset(pathname)) {
      next();
      return;
    }

    const html = await this.spa.render(pathname);
    if (html === null) {
      next();
      return;
    }

    // ⚠️ The shell is per-path (its meta tags depend on the clip) and cheap to
    // rebuild, so it must not be held by a shared cache: a stale shell is a
    // stale application. The hashed assets around it are a different story and
    // carry their own headers.
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(html);
  }

  /**
   * The path, without the query string and without going through `req.path` —
   * which is relative to a middleware's mount point.
   *
   * Left percent-encoded: the route matchers only care about a leading integer,
   * and an encoded path is what belongs in `og:url` anyway. The base is a
   * throwaway; only `pathname` is read.
   */
  private pathnameOf(req: Request): string {
    return new URL(req.originalUrl, 'http://spa.invalid').pathname;
  }

  private looksLikeAsset(pathname: string): boolean {
    return pathname.slice(pathname.lastIndexOf('/') + 1).includes('.');
  }
}
