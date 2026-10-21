import type { EpisodeDetail, EpisodeWaveform } from '#/domain/episodes/episode.entity';
import type {
  EpisodeListQuery,
  EpisodePage,
  EpisodeRepository,
  EpisodeWaveformQuery,
} from '#/domain/episodes/episode.repository';
import {
  episodesControllerFindOne,
  episodesControllerGetWaveform,
  episodesControllerList,
} from '#/infrastructure/generated';
import { assertResponseOk, translateHttpError } from '#/infrastructure/http/translate-http-error';
import {
  episodeDetailSchema,
  episodeListResponseSchema,
  episodeWaveformSchema,
} from './episode.dto';
import { toEpisodeDetail, toEpisodeListItem, toEpisodeWaveform } from './episode.mapper';

/**
 * ⚠️ Both methods forward `signal` into the generated operation, which is what
 * puts it on the `Request` and therefore on `fetch`. Without that last hop the
 * whole chain above is decoration — see `ClipHttpRepository`.
 */
export class EpisodeHttpRepository implements EpisodeRepository {
  async list(query: EpisodeListQuery, signal?: AbortSignal): Promise<EpisodePage> {
    try {
      const {
        data,
        error: failure,
        response,
      } = await episodesControllerList({
        signal,
        // ⚠️ No `order` and no `tags`: this endpoint has neither. Episodes come
        // back newest-first always, and `search` covers the title alone.
        //
        // ⚠️ `withClips` is sent only when it is TRUE. The backend rejects
        // anything but the two literal spellings, and `false` and absent mean
        // the same thing — so omitting it keeps the default out of the URL, the
        // same rule `useFilteredList` applies to every other filter.
        query: {
          page: query.page,
          limit: query.limit,
          search: query.search,
          withClips: query.withClips === true ? true : undefined,
        },
      });
      assertResponseOk(response, failure);
      const parsed = episodeListResponseSchema.parse(data);
      return {
        results: parsed.results.map(toEpisodeListItem),
        total: parsed.total,
      };
    } catch (error) {
      throw translateHttpError(error, signal);
    }
  }

  async findById(id: number, signal?: AbortSignal): Promise<EpisodeDetail> {
    try {
      const {
        data,
        error: failure,
        response,
      } = await episodesControllerFindOne({ path: { id }, signal });
      assertResponseOk(response, failure);
      return toEpisodeDetail(episodeDetailSchema.parse(data));
    } catch (error) {
      throw translateHttpError(error, signal);
    }
  }

  async getWaveform(
    id: number,
    query: EpisodeWaveformQuery = {},
    signal?: AbortSignal,
  ): Promise<EpisodeWaveform> {
    try {
      const {
        data,
        error: failure,
        response,
      } = await episodesControllerGetWaveform({
        path: { id },
        query: { from: query.from, to: query.to, points: query.points },
        signal,
      });
      assertResponseOk(response, failure);
      return toEpisodeWaveform(episodeWaveformSchema.parse(data));
    } catch (error) {
      throw translateHttpError(error, signal);
    }
  }
}
