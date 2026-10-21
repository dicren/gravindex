import type { Tag } from '#/domain/tags/tag.entity';
import type { AddTagOutcome, Clip, ClipListItem, ClipOrder } from './clip.entity';
import type { VoteOutcome, VoteValue } from './vote.entity';

/**
 * The library's filter, exactly as the API takes it.
 *
 * ⚠️ `search` and `tags` interact in a way that looks like a bug and is
 * deliberate: when both are present the search also restricts which tag rows
 * the tag filter can see. The backend keeps this so that shared URLs keep
 * returning the same results, so this layer passes both parameters through
 * untouched and compensates for nothing client-side.
 */
export interface ClipListQuery {
  /** 1-based, like the API and like the URL the UI puts it in. */
  readonly page?: number;
  readonly limit?: number;
  readonly order?: ClipOrder;
  /** Case- and accent-INsensitive substring over clip title, episode title and tags. */
  readonly search?: string;
  /** A clip must carry EVERY tag listed (AND, not OR), matched EXACTLY —
   *  case- and accent-sensitive, unlike `search`. Never normalize these. */
  readonly tags?: readonly Tag[];
}

/** `total` is the number of matching rows ignoring pagination, so a page past
 *  the end comes back with empty `results` and the real total. */
export interface ClipPage {
  readonly results: readonly ClipListItem[];
  readonly total: number;
}

/** What the editor publishes. Times are whole seconds, `end` greater than `start`. */
export interface NewClip {
  readonly episodeId: number;
  readonly title: string;
  readonly start: number;
  readonly end: number;
  readonly tags: readonly Tag[];
}

/**
 * Port implemented by `infrastructure/clips/clip-http.repository.ts`.
 *
 * ⚠️ **No method takes a voter token.** The writes need one, but it is INJECTED
 * into the adapter — a `VoterTokenProvider` in its constructor, wired in
 * `config/clips.config.ts` (see `domain/identity/voter-token.provider.ts`). It
 * is never fetched from storage inside a method, and it never travels through
 * the application layer or a view: nothing above this line should have to know
 * that anonymous identity exists at all.
 *
 * The API's own asymmetry survives inside the adapter: `vote` cannot work
 * without a token (it is what deduplicates), while `create` and `addTag` only
 * keep it as a moderation trail.
 *
 * ⚠️ **Reads take an `AbortSignal`; writes do not, and that split is the
 * point.** A read can be superseded — the next keystroke in the search box
 * makes the request in flight worthless — so the caller must be able to
 * withdraw it. A write cannot: cancelling a vote or a clip creation halfway
 * leaves the server having done something nobody can observe, which is worse
 * than waiting. Nothing in the app asks for that and nothing should offer it.
 *
 * ⚠️ The signal is a plain web standard, deliberately. It arrives from Pinia
 * Colada in `vue/`, but no Colada or Vue type crosses this line — `core/` stays
 * framework-free and the lint boundaries enforce it.
 */
export interface ClipRepository {
  list(query: ClipListQuery, signal?: AbortSignal): Promise<ClipPage>;

  findById(id: number, signal?: AbortSignal): Promise<Clip>;

  /**
   * The `Relacionados · comparten tag` strip on the clip permalink: up to six
   * clips sharing at least one tag with this one, ordered by how many they
   * share, then by `up`, then by id.
   *
   * ⚠️ A real endpoint rather than a tag filter run from the browser, and the
   * reason is the ORDER, not the fetch: most clips carry a single tag, so
   * `GET /clips?tags[]=` would return whatever the default sort produced and
   * call it relatedness. A clip with no tags answers an empty list, and the
   * section simply does not render.
   */
  listRelated(clipId: number, signal?: AbortSignal): Promise<ClipListItem[]>;

  create(draft: NewClip): Promise<Clip>;

  /** Fire-and-forget play counter: one row per call, nothing read back, no
   *  identity of any kind stored — not even the token. */
  registerPlay(clipId: number): Promise<void>;

  vote(clipId: number, value: VoteValue): Promise<VoteOutcome>;

  addTag(clipId: number, tag: Tag): Promise<AddTagOutcome>;
}
