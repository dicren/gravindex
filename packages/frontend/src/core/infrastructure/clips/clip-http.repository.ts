import type { AddTagOutcome, Clip, ClipListItem } from '#/domain/clips/clip.entity';
import type {
  ClipListQuery,
  ClipPage,
  ClipRepository,
  NewClip,
} from '#/domain/clips/clip.repository';
import type { VoteOutcome, VoteValue } from '#/domain/clips/vote.entity';
import { ValidationError } from '#/domain/errors';
import { VOTER_TOKEN_HEADER, type VoterToken } from '#/domain/identity/voter-token.entity';
import type { VoterTokenProvider } from '#/domain/identity/voter-token.provider';
import type { Tag } from '#/domain/tags/tag.entity';
import {
  clipsControllerAddTag,
  clipsControllerCreate,
  clipsControllerFindOne,
  clipsControllerFindRelated,
  clipsControllerList,
  clipsControllerPlay,
  clipsControllerVote,
} from '#/infrastructure/generated';
import { assertResponseOk, translateHttpError } from '#/infrastructure/http/translate-http-error';
import {
  clipListResponseSchema,
  clipSchema,
  clipTagResponseSchema,
  relatedClipsResponseSchema,
  voteResponseSchema,
} from './clip.dto';
import { toClip, toClipListItem, toVoteOutcome } from './clip.mapper';

/**
 * The clips adapter. Four steps per method, always in this order: call the
 * generated operation → reject a non-2xx → parse with the feature's narrow
 * schema → map to entities. No URL is written by hand anywhere in this file.
 *
 * ⚠️ The anonymous voter token is **injected**, never read from storage here:
 * the identity module owns where it lives, this file owns the one header it
 * becomes. `getToken()` is synchronous and always answers, so the writes do not
 * branch on its absence — except `vote`, which cannot work without it.
 *
 * ⚠️ **`signal` is where the cancellation chain ends.** It reaches the two
 * reads from Pinia Colada, through the use case, and is handed to the generated
 * operation, which puts it on the `Request` it builds — `ky` then adopts a
 * `Request`'s own signal, so `fetch` really does receive it. That last hop is
 * the one that makes the rest work: without it nothing aborts, however much
 * of the chain exists. The writes below take no signal at all, on purpose
 * (see `ClipRepository`).
 */
export class ClipHttpRepository implements ClipRepository {
  constructor(private readonly voterTokenProvider: VoterTokenProvider) {}

  async list(query: ClipListQuery, signal?: AbortSignal): Promise<ClipPage> {
    try {
      const {
        data,
        error: failure,
        response,
      } = await clipsControllerList({
        signal,
        // ⚠️ Passed straight through, `undefined` included — the generated
        // serializer skips undefined keys, so an absent filter never becomes
        // `?search=undefined`. `tags` goes out as the repeated `tags=a&tags=b`
        // form (OpenAPI `style: form`, `explode: true`); the backend also still
        // accepts the `tags[]=` shape that previously shared links carry, for
        // compatibility, but the generated client emits the canonical one.
        query: {
          page: query.page,
          limit: query.limit,
          order: query.order,
          search: query.search,
          tags: query.tags === undefined ? undefined : [...query.tags],
        },
      });
      assertResponseOk(response, failure);
      const parsed = clipListResponseSchema.parse(data);
      return {
        results: parsed.results.map(toClipListItem),
        total: parsed.total,
      };
    } catch (error) {
      throw translateHttpError(error, signal);
    }
  }

  async findById(id: number, signal?: AbortSignal): Promise<Clip> {
    try {
      const {
        data,
        error: failure,
        response,
      } = await clipsControllerFindOne({ path: { id }, signal });
      assertResponseOk(response, failure);
      // ⚠️ `clipSchema`, not `clipListItemSchema`: this payload carries `up`
      // but no `points`, and must not be typed as if it might.
      return toClip(clipSchema.parse(data));
    } catch (error) {
      throw translateHttpError(error, signal);
    }
  }

  async listRelated(clipId: number, signal?: AbortSignal): Promise<ClipListItem[]> {
    try {
      const {
        data,
        error: failure,
        response,
      } = await clipsControllerFindRelated({ path: { id: clipId }, signal });
      assertResponseOk(response, failure);
      // A bare array, not an envelope: there is no pagination on six rows.
      return relatedClipsResponseSchema.parse(data).map(toClipListItem);
    } catch (error) {
      throw translateHttpError(error, signal);
    }
  }

  async create(draft: NewClip): Promise<Clip> {
    try {
      const {
        data,
        error: failure,
        response,
      } = await clipsControllerCreate({
        body: {
          title: draft.title,
          start: draft.start,
          end: draft.end,
          tags: [...draft.tags],
          // The wire calls it `episode` and means the id.
          episode: draft.episodeId,
        },
        headers: this.voterTokenHeader(),
      });
      assertResponseOk(response, failure);
      return toClip(clipSchema.parse(data));
    } catch (error) {
      throw translateHttpError(error);
    }
  }

  async registerPlay(clipId: number): Promise<void> {
    try {
      const { error: failure, response } = await clipsControllerPlay({ path: { id: clipId } });
      assertResponseOk(response, failure);
      // ⚠️ **No token on this one.** It is the single write that stores no
      // identity of any kind, and the `playback` table's 788 distinct IP
      // addresses — kept for a counter nothing ever read back — are why that
      // is worth being deliberate about.
      //
      // The body (`{ id }`) is not parsed either: nothing consumes it, and
      // validating a value no one uses would only invent a way for a
      // fire-and-forget call to fail.
    } catch (error) {
      throw translateHttpError(error);
    }
  }

  async vote(clipId: number, value: VoteValue): Promise<VoteOutcome> {
    try {
      const token = this.voterTokenProvider.getToken();
      // ⚠️ The one rule this adapter enforces before reaching the network.
      // `getToken()` is contractually total, so this is unreachable with the
      // real provider — but the alternative to checking is sending an empty
      // header and letting the backend answer 400, which would blame the server
      // for a bug on this side and burn a round trip doing it.
      // (`ValidationError`'s doc names this as its one deliberate exception to
      // "thrown from `application`", and says why it lives here: this is where
      // the token is.)
      if (token === '') {
        throw new ValidationError('Voting needs an anonymous voter token, and none was available.');
      }

      const {
        data,
        error: failure,
        response,
      } = await clipsControllerVote({
        path: { id: clipId, value },
        // Required by the generated type because it is required by the API:
        // the `(clip, token)` pair is what deduplicates the vote.
        headers: { [VOTER_TOKEN_HEADER]: token },
      });
      // ⚠️ A repeated vote is a 201, so this passes — the refusal is in the
      // body, and `toVoteOutcome` is what reads it.
      assertResponseOk(response, failure);
      return toVoteOutcome(voteResponseSchema.parse(data), value);
    } catch (error) {
      throw translateHttpError(error);
    }
  }

  async addTag(clipId: number, tag: Tag): Promise<AddTagOutcome> {
    try {
      const {
        data,
        error: failure,
        response,
      } = await clipsControllerAddTag({
        // ⚠️ The tag travels in the PATH. The generated serializer
        // `encodeURIComponent`s it, which is what keeps accents, spaces and a
        // literal `/` from becoming a different route (or a 404).
        path: { id: clipId, value: tag },
        headers: this.voterTokenHeader(),
      });

      // ⚠️ Checked BEFORE `assertResponseOk`, which treats every 4xx as a
      // refusal worth surfacing. A 409 here means the clip already carries the
      // tag: an ordinary outcome, not a failure — the user can see the tag
      // right there on the card — and the one place the tag write disagrees
      // with the vote write, which reports its own repeat inside a 201 body.
      if (response?.status === 409) {
        return { status: 'already-present', tag };
      }
      assertResponseOk(response, failure);

      return { status: 'added', tag: clipTagResponseSchema.parse(data).tag };
    } catch (error) {
      throw translateHttpError(error);
    }
  }

  /**
   * The optional trail on `POST /clips` and `POST /clips/:id/tag/:value`.
   *
   * ⚠️ Omitted entirely rather than sent empty when there is no token: the
   * backend reads a missing header as "anonymous, no trail" and a malformed one
   * as a client bug worth a 400.
   */
  private voterTokenHeader(): { [VOTER_TOKEN_HEADER]?: VoterToken } | undefined {
    const token = this.voterTokenProvider.getToken();
    return token === '' ? undefined : { [VOTER_TOKEN_HEADER]: token };
  }
}
