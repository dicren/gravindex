import { EntityManager } from '@mikro-orm/postgresql';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { dedupe } from '../../common/validation/to-string-array';
import { Clip } from '../../database/entities/Clip.entity';
import { Episode } from '../../database/entities/Episode.entity';
import { Tag } from '../../database/entities/Tag.entity';
import { Vote } from '../../database/entities/Vote.entity';
import {
  buildClipListQuery,
  buildRelatedClipsQuery,
  ClipListRow,
  ClipPayloadRow,
  isPopulatedRow,
} from './clips.sql';
import {
  ClipDto,
  ClipEpisodeDto,
  ClipListItemDto,
  ClipListResponseDto,
  ClipTagDto,
  PlaybackResponseDto,
  VoteResponseDto,
} from './dto/clip-response.dto';
import { ClipsQueryDto } from './dto/clips-query.dto';
import { CreateClipDto } from './dto/create-clip.dto';

// The exact string the frontend branches on. It is part of the published
// contract: changing a single character breaks the UI's check.
export const ALREADY_VOTED = 'you have already voted';

interface VoteUpsertRow {
  previous_value: number | null;
  affected: number;
}

@Injectable()
export class ClipsService {
  constructor(private readonly em: EntityManager) {}

  // ---------------------------------------------------------------- reads

  async list(query: ClipsQueryDto): Promise<ClipListResponseDto> {
    const { sql, params } = buildClipListQuery(query);

    // Raw, and on purpose. The result is not an entity graph: it is a page of
    // clips carrying two aggregates that are not columns, and building it with
    // the ORM would mean either N+1 round trips or hand-written SQL anyway.
    // ⚠️ Every value the client controls arrives as a `?` binding; the only
    // client-influenced FRAGMENT is the sort column, and that comes out of a
    // whitelist map (see `clips.sql.ts`).
    const rows = (await this.em.getConnection().execute(sql, params)) as unknown as ClipListRow[];

    const first = rows[0];
    if (first === undefined) {
      // Cannot happen — the `total` CTE always yields a row — but the type
      // says it can, and a silent `0` beats a crash if it ever does.
      return { results: [], total: 0 };
    }

    return {
      // A page past the end of the result set still returns one row, carrying
      // the total and nothing else. That is the whole reason `total` is the
      // left side of the join.
      results: rows.filter(isPopulatedRow).map((row) => ClipsService.toListItem(row)),
      total: first.total,
    };
  }

  async findOne(id: number): Promise<ClipDto> {
    const clip = await this.em.findOne(Clip, { id }, { populate: ['episode', 'tags'] });

    if (!clip) {
      // Bare, so the body is the standard `{ statusCode, message: 'Not Found' }`.
      throw new NotFoundException();
    }

    // ⚠️ `up` is counted here — one extra round trip on a single-row
    // endpoint, which is the whole cost of the field. It stays a
    // second statement rather than becoming a raw join because everything else
    // on this path is an entity graph, and `count` over a foreign key is the
    // one thing MikroORM does as well as hand-written SQL.
    //
    // No `points` here: with every vote positive it would be a second name
    // for this number (see `ClipDto`).
    return {
      ...ClipsService.toClipDto(
        clip,
        clip.tags.getItems().map((tag) => tag.tag),
      ),
      up: await this.countUpVotes(id),
    };
  }

  // The `Relacionados · comparten tag` strip on the clip permalink. Rows are the
  // same shape the library's are, because the view renders them with the same
  // component.
  //
  // ⚠️ 404s on an unknown clip rather than answering an empty list: `/clips/999`
  // is a 404 and `/clips/999/related` claiming "no related clips" would be a
  // different answer to the same question.
  async findRelated(id: number): Promise<ClipListItemDto[]> {
    await this.assertClipExists(id);

    const { sql, params } = buildRelatedClipsQuery(id);
    const rows = (await this.em
      .getConnection()
      .execute(sql, params)) as unknown as ClipPayloadRow[];

    return rows.map((row) => ClipsService.toListItem(row));
  }

  // --------------------------------------------------------------- writes

  async create(dto: CreateClipDto, token: string | null): Promise<ClipDto> {
    return this.em.transactional(async (em) => {
      const episode = await em.findOne(Episode, { id: dto.episode });

      // A missing episode is a 404 here, not a foreign-key failure in the insert.
      if (!episode) {
        throw new NotFoundException(`Episode ${dto.episode} does not exist`);
      }

      // ⚠️ `createdAt` is spelled out because `RequiredEntityData` demands it:
      // the entity's `= new Date()` initialiser is invisible to
      // `ReflectMetadataProvider`, which reads decorator metadata and not the
      // source. The value matches the column's `default now()`.
      const now = new Date();

      const clip = em.create(Clip, {
        title: dto.title,
        start: dto.start,
        end: dto.end,
        episode,
        token,
        createdAt: now,
      });

      // Two identical tags in one request are collapsed here: sent as they are,
      // they would violate the composite primary key.
      const tags = dedupe(dto.tags);
      for (const tag of tags) {
        em.create(Tag, { clip, tag, token, createdAt: now });
      }

      await em.flush();

      // ⚠️ `up: 0` is a fact, not a placeholder: the clip was published a
      // millisecond ago and nobody can have voted for it yet.
      return { ...ClipsService.toClipDto(clip, tags), up: 0 };
    });
  }

  // ⚠️ The dedup lives in the SCHEMA (`vote_clip_id_token_unique`), not in a
  // read-then-write: a check-then-insert would let two concurrent requests both
  // pass the check. This is ONE statement:
  //
  //   `previous` reads the row as it was before the statement, from the same
  //   snapshot, so the value being replaced is known without a second trip;
  //   the upsert inserts, or updates ONLY when the value actually changes.
  //
  // A repeat of the same vote therefore fails the `where`, updates nothing, and
  // `affected` comes back 0 — which is the `error` response, not an HTTP error.
  //
  // `token` is required here (see `RequiredVoterToken`): postgres does not
  // collide NULLs in a unique constraint, so a null token would make every
  // repeat vote succeed silently.
  async vote(clipId: number, value: number, token: string): Promise<VoteResponseDto> {
    await this.assertClipExists(clipId);

    const sql = `
      with "previous" as (
        select "value" from "vote" where "clip_id" = ? and "token" = ?
      ),
      "upsert" as (
        insert into "vote" ("clip_id", "value", "token") values (?, ?, ?)
        on conflict ("clip_id", "token") do update
          set "value" = excluded."value", "created_at" = now()
          where "vote"."value" <> excluded."value"
        returning "id"
      )
      select
        (select "value" from "previous") as "previous_value",
        (select count(*)::int from "upsert") as "affected"
    `;

    const rows = (await this.em
      .getConnection()
      .execute(sql, [clipId, token, clipId, value, token])) as unknown as VoteUpsertRow[];

    const row = rows[0];

    if (row === undefined || row.affected === 0) {
      return { delete: 0, error: ALREADY_VOTED, add: 0 };
    }

    return { delete: row.previous_value ?? 0, error: null, add: value };
  }

  // The duplicate is rejected by the composite primary key rather than by a
  // preceding SELECT — same race, same fix. Unlike the vote endpoint, this one
  // really does answer 409; the two write paths disagree with each other and
  // both behaviours are the specification.
  async addTag(clipId: number, tag: string, token: string | null): Promise<ClipTagDto> {
    await this.assertClipExists(clipId);

    const sql = `
      insert into "tag" ("clip_id", "tag", "token") values (?, ?, ?)
      on conflict ("clip_id", "tag") do nothing
      returning "clip_id" as "clip_id", "tag" as "tag"
    `;

    const rows = (await this.em.getConnection().execute(sql, [clipId, tag, token])) as unknown as {
      clip_id: number;
      tag: string;
    }[];

    const row = rows[0];
    if (row === undefined) {
      throw new ConflictException('Tag repeated');
    }

    return { clipId: row.clip_id, tag: row.tag };
  }

  // Fire-and-forget counter: one append-only row per call. ⚠️ No identity of
  // any kind is stored — not an IP, not the token — for a counter nothing reads
  // back.
  async play(clipId: number): Promise<PlaybackResponseDto> {
    await this.assertClipExists(clipId);

    const rows = (await this.em
      .getConnection()
      .execute(`insert into "playback" ("clip_id") values (?) returning "id"`, [
        clipId,
      ])) as unknown as { id: number }[];

    const row = rows[0];
    if (row === undefined) {
      throw new NotFoundException();
    }

    return { id: row.id };
  }

  // -------------------------------------------------------------- helpers

  // The three write endpoints all reference a clip by a path parameter. Without
  // this check a missing clip would surface as a foreign-key violation (a 500)
  // instead of a 404.
  private async assertClipExists(clipId: number): Promise<void> {
    if ((await this.em.count(Clip, { id: clipId })) === 0) {
      throw new NotFoundException();
    }
  }

  // ⚠️ `count`, not `sum`. Every vote is a +1 now (`VoteParamsDto`), so the two
  // agree — and counting cannot be thrown off by a value that should not exist.
  private countUpVotes(clipId: number): Promise<number> {
    return this.em.count(Vote, { clip: clipId });
  }

  // ⚠️ Returns everything but `up`, and the callers add it. The count is not a
  // column and neither of the two callers gets it from the same place — one
  // aggregates it, the other knows it is zero.
  private static toClipDto(clip: Clip, tags: readonly string[]): Omit<ClipDto, 'up'> {
    return {
      id: clip.id,
      title: clip.title,
      start: clip.start,
      end: clip.end,
      episode: {
        id: clip.episode.id,
        title: clip.episode.title,
        cover: clip.episode.cover,
        file: clip.episode.file,
        originalUrl: clip.episode.originalUrl,
        date: clip.episode.date.toISOString(),
      },
      tags: ClipsService.toTagDtos(clip.id, tags),
    };
  }

  private static toListItem(row: ClipPayloadRow): ClipListItemDto {
    const episode: ClipEpisodeDto = {
      id: row.episode_id,
      title: row.episode_title,
      cover: row.episode_cover,
      file: row.episode_file,
      originalUrl: row.episode_original_url,
      date: row.episode_date,
    };

    return {
      id: row.id,
      title: row.title,
      start: row.start,
      end: row.end,
      episode,
      tags: ClipsService.toTagDtos(row.id, row.tags),
      up: row.up,
      points: row.points,
    };
  }

  // Sorted, everywhere tags are returned, so the list and the permalink agree.
  // ⚠️ Code-point order, not `localeCompare`: it is deterministic regardless of
  // the process locale, and it is the order the API has always returned, so accented
  // tags land in the same place every time.
  private static toTagDtos(clipId: number, tags: readonly string[]): ClipTagDto[] {
    return [...tags].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((tag) => ({ clipId, tag }));
  }
}
