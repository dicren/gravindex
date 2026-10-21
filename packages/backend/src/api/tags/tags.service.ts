import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { TagCountDto } from './dto/tag-response.dto';
import { TAGS_QUERY, TagRow } from './tags.sql';

@Injectable()
export class TagsService {
  constructor(private readonly em: EntityManager) {}

  // A flat array of `{ tag, count }`, not an envelope: this is the list the
  // library's tag filter is built from, and there is no pagination on it. 102
  // distinct tags over 382 rows in production, so the grouping is free.
  //
  // ⚠️ The counts have to come from here rather than from the browser — see
  // `tags.sql.ts`.
  async list(): Promise<TagCountDto[]> {
    const rows = (await this.em.getConnection().execute(TAGS_QUERY)) as unknown as TagRow[];

    return rows.map((row) => ({ tag: row.tag, count: row.count }));
  }
}
