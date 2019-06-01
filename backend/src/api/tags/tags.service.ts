import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tag } from '../../database/entities/Tag';

@Injectable()
export class TagsService {
  constructor(
    @InjectRepository(Tag)
    private readonly tagclipRepository: Repository<Tag>,
  ) {}

  async getTags() {
    const all = await this.tagclipRepository
      .createQueryBuilder('tag')
      .select('DISTINCT tag', 'tag')
      .addOrderBy('tag')
      .getRawMany();
    return all.map(t => t.tag);
  }
}
