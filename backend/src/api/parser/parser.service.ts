import {Injectable, Logger} from '@nestjs/common';
import * as $ from 'cheerio';
import axios from 'axios';
import {Episode} from '../../database/entities/Episode';
import {Repository} from 'typeorm';
import {InjectRepository} from '@nestjs/typeorm';
import * as rax from 'retry-axios';

@Injectable()
export class ParserService {
  private readonly logger = new Logger(ParserService.name);
  private readonly loadsPararells = 10;
  private readonly timeout = 20 * 1000;

  constructor(
    @InjectRepository(Episode)
    private readonly episodeRepository: Repository<Episode>,
  ) {
    rax.attach();
  }

  async parse(category?: string, page?: number) {
    const response = {
      found: 0,
      saved: 0,
      inddbb: 0,
      errors: [],
    };

    // episodios, perlitas, directo, radiogravina, verite, episodio-remasterizado, crossover

    try {
      const source = axios.CancelToken.source();
      setTimeout(() => {
        source.cancel();
        // Timeout Logic
      }, this.timeout);

      let url;
      if (category && page) {
        url = `https://gravina82.com/category/${category}/page/${page}/`;
      } else {
        url = 'https://gravina82.com/';
      }

      const pageRequest = await axios.get(url, {
        cancelToken: source.token,
        timeout: this.timeout,
      });
      const $web = $(pageRequest.data);

      const entries = [];
      // noinspection TypeScriptValidateJSTypes
      $('.entry > .thumbnail > a', $web).each((index, element) => {
        entries.push($(element).attr('href'));
      });

      response.found = entries.length;
      let promises = [];
      for (const url of entries) {
        promises.push(
          new Promise(async resolve => {
            if (
              (await this.episodeRepository.count({ originalUrl: url })) === 0
            ) {
              this.logger.log('Getting from ' + url);

              try {
                const source2 = axios.CancelToken.source();
                setTimeout(() => {
                  source2.cancel();
                  // Timeout Logic
                }, this.timeout);

                const pageEntryRequest = await axios.get(url, {
                  timeout: this.timeout,
                  cancelToken: source2.token,
                });
                const entryWeb = $(pageEntryRequest.data);
                const episode = new Episode();

                entryWeb.each((index, node) => {
                  if (node.type === 'tag' && node.name === 'meta') {
                    if (node.attribs.property === 'article:published_time') {
                      episode.date = new Date(node.attribs.content);
                      if (episode.description != null) {
                        return false;
                      }
                    } else if (node.attribs.property === 'og:description') {
                      episode.description = node.attribs.content;
                      if (episode.date != null) {
                        return false;
                      }
                    }
                  }
                });

                episode.title = $('.post-text h1.title', entryWeb).text();
                episode.cover =
                  $('.post-text img', entryWeb).attr('src') ||
                  $('.single-thumb img', entryWeb).attr('src') ||
                  'https://gravina82.com/wp-content/uploads/2019/03/GRAVINA82_1400PX-281844_222x180.png';
                episode.originalUrl = url;

                $('.post-text a', entryWeb).each((index, element) => {
                  const href = $(element).attr('href');
                  if (
                    href.endsWith('.mp3') &&
                    (href.includes('podcastmedia') || href.includes('uploads'))
                  ) {
                    episode.file = href;
                    return false;
                  }
                });

                await this.episodeRepository.save(episode);
                response.saved++;
                this.logger.log('Saved ' + episode.title);
              } catch (ex) {
                response.errors.push(ex);
              } finally {
                resolve();
              }
            } else {
              response.inddbb++;
              resolve();
            }
          }),
        );
        if (promises.length >= this.loadsPararells) {
          this.logger.log('Wait ' + promises.length + ' pages...');
          await Promise.all(promises);
          promises = [];
        }
      }
      await Promise.all(promises);

      return response;
    } catch (ex) {
      // tslint:disable-next-line:no-console
      console.log(ex); // Con logger no funciona.
      if (ex.response.status === 404) {
        return {
          error: 404,
        };
      }
    }
  }
}
