import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Clip } from '../database/entities/Clip.entity';
import { Episode } from '../database/entities/Episode.entity';
import { resolvePublicUrl, resolveSpaDistDir } from './spa.config';
import { injectSocialMeta, matchSpaRoute, SocialMeta } from './spa-html';

// Serving the SPA and its social previews.
//
// The rule is one sentence long: everyone gets the SAME HTML. No `User-Agent`
// sniffing, no bot list, no content that differs by visitor. A crawler and a
// browser both receive `index.html` with the clip's meta tags in its `<head>`;
// the browser ignores them and boots the SPA as usual. See root AGENTS.md,
// "Serving the SPA, and social previews without a proxy".

const SITE_NAME = 'Índice gravinero';

@Injectable()
export class SpaService implements OnModuleInit {
  private readonly logger = new Logger(SpaService.name);
  private readonly indexPath: string;
  private readonly publicUrl: string;
  private readonly revalidate: boolean;

  // ⚠️ The built `index.html` is read once and kept here, not read per request.
  private cache: { html: string; mtimeMs: number } | null = null;
  private absenceLogged = false;

  constructor(
    private readonly em: EntityManager,
    config: ConfigService,
  ) {
    this.indexPath = join(resolveSpaDistDir(config), 'index.html');
    this.publicUrl = resolvePublicUrl(config);
    // In a deployed image the SPA build never changes under a running process,
    // so the cache is the whole story. In dev it changes constantly, and a
    // `stat` — which does not read the file — is what keeps a rebuild visible
    // without restarting the API.
    this.revalidate = config.get<string>('NODE_ENV') !== 'production';
  }

  // ⚠️ Warms the cache, and NEVER throws when there is nothing to warm it with.
  // The frontend build is optional, and an API that refuses to boot without one
  // is useless in exactly the situation it is most needed.
  async onModuleInit(): Promise<void> {
    if ((await this.readIndexHtml()) !== null) {
      this.logger.log(`Serving the SPA from ${this.indexPath}`);
    }
  }

  /**
   * The HTML to answer `pathname` with, or `null` when there is no SPA build to
   * serve — in which case the caller falls through and Nest answers 404.
   *
   * ⚠️ A clip that does not exist still gets the untouched `index.html` and an
   * HTTP 200: rendering the 404 is **the SPA's** decision, and a backend that
   * 404s or redirects first takes it away.
   *
   * ⚠️ And "untouched" is literal — the built `index.html` ships **no** social
   * tags of its own, only `<title>Índice gravinero</title>`. So a dead permalink
   * previews as the bare site name rather than as a clip that is not there,
   * which is the honest outcome; there is no generic `og:*` fallback to inherit,
   * and adding one to `index.html` would fight the injector for clips that do
   * exist (see the comment in `packages/frontend/index.html`).
   */
  async render(pathname: string): Promise<string | null> {
    const html = await this.readIndexHtml();
    if (html === null) {
      return null;
    }

    const social = await this.resolveSocialMeta(pathname);

    return social === null ? html : injectSocialMeta(html, social);
  }

  private async resolveSocialMeta(pathname: string): Promise<SocialMeta | null> {
    const route = matchSpaRoute(pathname);
    if (route.kind === 'other') {
      return null;
    }

    // ⚠️ Fork: the config sets `allowGlobalContext: false`, and forking makes
    // this independent of whether a request context happens to be open — which
    // depends on middleware ordering, and middleware ordering is not something
    // a social preview should be able to break.
    const em = this.em.fork();

    try {
      if (route.kind === 'clip') {
        const clip = await em.findOne(Clip, { id: route.id }, { populate: ['episode'] });

        return clip === null
          ? null
          : {
              title: `${clip.title} | ${SITE_NAME}`,
              description: `Clip de ${clip.episode.title}`,
              image: clip.episode.cover,
              url: this.absoluteUrl(pathname),
            };
      }

      const episode = await em.findOne(Episode, { id: route.id });

      return episode === null
        ? null
        : {
            title: `${episode.title} | ${SITE_NAME}`,
            description: 'Escucha el episodio y sus clips en el Índice gravinero.',
            image: episode.cover,
            url: this.absoluteUrl(pathname),
          };
    } catch (error) {
      // The shell is what boots the application; it must survive a database
      // that does not answer. Losing the preview is a degradation, a 500 is an
      // outage.
      this.logger.error(`Could not resolve social meta for ${pathname}`, error);

      return null;
    }
  }

  /** ⚠️ Absolute, from `PUBLIC_URL`. `pathname` arrives already URL-encoded. */
  private absoluteUrl(pathname: string): string {
    return `${this.publicUrl}${pathname}`;
  }

  /**
   * The cached `index.html`, or `null` if there is no readable build.
   *
   * Cache policy, and the two halves are different on purpose:
   *
   * - **Present and deployed** (`NODE_ENV=production`): read exactly once, held
   *   for the life of the process. A new SPA build means a new image and a new
   *   process, so there is nothing to invalidate.
   * - **Present in dev**: revalidated by `mtime`. A `stat` is not a read of the
   *   file, and it is what makes `npm run build` in the frontend show up on the
   *   next refresh instead of after a restart.
   * - **Absent**: retried on every request, so a build that appears while the
   *   API is running starts being served without a restart. The warning is
   *   emitted once, not once per request.
   */
  private async readIndexHtml(): Promise<string | null> {
    if (this.cache !== null && !this.revalidate) {
      return this.cache.html;
    }

    try {
      const { mtimeMs } = await stat(this.indexPath);

      if (this.cache?.mtimeMs === mtimeMs) {
        return this.cache.html;
      }

      const html = await readFile(this.indexPath, 'utf8');
      this.cache = { html, mtimeMs };
      this.absenceLogged = false;

      return html;
    } catch {
      // Missing, unreadable, or a directory: all the same answer.
      if (!this.absenceLogged) {
        this.absenceLogged = true;
        this.logger.warn(
          `No readable SPA build at ${this.indexPath} — the API is up, but every non-/api path 404s until one is built`,
        );
      }
      this.cache = null;

      return null;
    }
  }
}
