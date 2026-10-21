import { EntityManager } from '@mikro-orm/postgresql';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Clip } from '../database/entities/Clip.entity';
import { Playback } from '../database/entities/Playback.entity';
import { Tag } from '../database/entities/Tag.entity';
import { Vote } from '../database/entities/Vote.entity';
import { AdminClipDto } from './dto/admin.dto';
import { RenameTagDto } from './dto/tag.dto';
import { UpdateClipDto } from './dto/update-clip.dto';

/**
 * The moderation operations that would otherwise have to be performed by hand,
 * over `psql`.
 *
 * ⚠️ It reaches the tables through the `EntityManager` on purpose and imports
 * nothing from `api/clips` or `api/tags`. Those modules own the PUBLIC contract,
 * which must not change lightly; this one is new and owes it nothing. Sharing a
 * service between the two would mean every change to the public contract has to
 * keep an unversioned admin screen working, which is how the two surfaces drift
 * into each other.
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly em: EntityManager) {}

  async updateClip(id: number, dto: UpdateClipDto, actor: string): Promise<AdminClipDto> {
    const clip = await this.em.findOne(Clip, { id }, { populate: ['tags'] });
    if (!clip) throw new NotFoundException(`No clip with id ${id}.`);

    const start = dto.start ?? clip.start;
    const end = dto.end ?? clip.end;
    // ⚠️ Checked against the MERGED values, not the body: a PATCH that only
    // moves `start` can still invert the cut. Clips with `end <= start` may
    // already exist in the loaded data, because it was written without
    // validation. This refuses to CREATE one; it does not retro-validate what is
    // there.
    if (end <= start) {
      throw new BadRequestException('end must be greater than start.');
    }

    if (dto.title !== undefined) clip.title = dto.title;
    clip.start = start;
    clip.end = end;
    await this.em.flush();

    this.logger.log(`${actor} edited clip ${id}`);
    return AdminClipDto.from(clip, this.tagsOf(clip));
  }

  /**
   * Hard delete, inside one transaction, dependents first.
   *
   * ⚠️ **A clip is not one row.** `vote`, `playback` and `tag` all reference it
   * with `on delete restrict` (see the schema baseline migration), so a bare
   * `delete from clip` raises a foreign-key violation on any clip anyone ever
   * used. The order below is the only one that works, and the transaction is
   * what stops a half-deleted clip — votes gone, clip still there — from being
   * a reachable state.
   *
   * **Why hard and not soft**, since both were on the table:
   *
   *  - A soft delete only deletes if every public query filters the flag, and
   *    those queries live in `api/clips`, `api/episodes` and `api/tags` — three
   *    modules, several queries, and one missed `where` is a "deleted" clip
   *    still on the front page. Correctness that depends on remembering is not
   *    correctness.
   *  - **Vote aggregates stay honest for free.** `up` is computed from the
   *    `vote` table at read time (root AGENTS.md, "Vote counts are not a
   *    column"). Deleting the votes with the clip means every vote row that
   *    exists points at a clip that exists. Soft delete would leave orphan votes
   *    that any future global aggregate (or a row-count check) would silently
   *    include.
   *  - The thing soft delete usually buys — undo — is not worth much here: the
   *    admin is the site's author, the volumes are tiny, and a mistaken delete
   *    is recoverable from the nightly database backup, not from a flag.
   *
   * ⚠️ **The id is NOT reused, and that is required, not incidental.** Clip ids
   * are public URLs (`https://indice.gravina82.com/<id>`) that people share.
   * Postgres sequences never go backwards on delete, so the next `insert into
   * clip` takes a fresh value — exactly the behaviour that leaves the two gaps
   * the catalogue already has (ids 175 and 176, whose permalinks must keep
   * 404ing). `admin.clips.spec.ts` asserts the next clip created after a delete
   * gets a strictly greater id.
   */
  async deleteClip(id: number, actor: string): Promise<void> {
    await this.em.transactional(async (em) => {
      const clip = await em.findOne(Clip, { id });
      if (!clip) throw new NotFoundException(`No clip with id ${id}.`);

      await em.nativeDelete(Vote, { clip: id });
      await em.nativeDelete(Playback, { clip: id });
      await em.nativeDelete(Tag, { clip: id });
      await em.nativeDelete(Clip, { id });
    });

    this.logger.log(`${actor} deleted clip ${id}`);
  }

  /**
   * Renames one tag on one clip.
   *
   * ⚠️ A tag IS the `(clip, tag)` pair — the whole primary key — so this cannot
   * be a property assignment on a loaded entity: MikroORM does not update a
   * primary key in place. `nativeUpdate` writes the SQL that Postgres is
   * perfectly happy to run.
   */
  async renameTag(clipId: number, dto: RenameTagDto, actor: string): Promise<AdminClipDto> {
    const clip = await this.em.findOne(Clip, { id: clipId }, { populate: ['tags'] });
    if (!clip) throw new NotFoundException(`No clip with id ${clipId}.`);

    if (dto.tag === dto.newTag) {
      // A no-op rename is a success, not a conflict with itself.
      return AdminClipDto.from(clip, this.tagsOf(clip));
    }
    if (!this.tagsOf(clip).includes(dto.tag)) {
      throw new NotFoundException(`Clip ${clipId} has no tag "${dto.tag}".`);
    }
    if (this.tagsOf(clip).includes(dto.newTag)) {
      // Merging two tags into one would silently delete a row. Say so instead.
      throw new ConflictException(`Clip ${clipId} already has the tag "${dto.newTag}".`);
    }

    await this.em.nativeUpdate(Tag, { clip: clipId, tag: dto.tag }, { tag: dto.newTag });
    this.logger.log(`${actor} renamed tag on clip ${clipId}`);

    // ⚠️ `nativeUpdate` bypasses the identity map, so the `clip` loaded above
    // still holds the old tag. Re-read rather than patch the stale collection.
    return this.getClip(clipId);
  }

  async deleteTag(clipId: number, tag: string, actor: string): Promise<void> {
    const affected = await this.em.nativeDelete(Tag, { clip: clipId, tag });
    if (affected === 0) {
      throw new NotFoundException(`Clip ${clipId} has no tag "${tag}".`);
    }
    this.logger.log(`${actor} deleted a tag from clip ${clipId}`);
  }

  async getClip(id: number): Promise<AdminClipDto> {
    const clip = await this.em.findOne(Clip, { id }, { populate: ['tags'], refresh: true });
    if (!clip) throw new NotFoundException(`No clip with id ${id}.`);
    return AdminClipDto.from(clip, this.tagsOf(clip));
  }

  private tagsOf(clip: Clip): string[] {
    return clip.tags.getItems().map((tag) => tag.tag);
  }
}
