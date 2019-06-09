import { Controller, Get, Logger } from '@nestjs/common';
import { TagsService } from './tags.service';

@Controller('tags')
export class TagsController {
  private readonly logger = new Logger(TagsController.name);

  constructor(private readonly tagsService: TagsService) {}

  @Get('/')
  async getTags(/*@Query() query: QueryOptions*/) {
    return await this.tagsService.getTags();
  }
}
