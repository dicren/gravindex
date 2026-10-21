import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TagCountDto } from './dto/tag-response.dto';
import { TagsService } from './tags.service';

@ApiTags('tags')
@Controller('tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  @ApiOperation({
    summary: 'Every distinct tag with how many clips carry it',
    description:
      'A flat array of `{ tag, count }` — no envelope and no pagination; there are 102 of them. ' +
      "It is what the library's tag filter offers, and `tag` is what `GET /clips?tags[]=…` " +
      'matches EXACTLY (case- and accent-sensitive), which is why the order is code-point and ' +
      'not linguistic. ⚠️ Objects, not a flat `string[]`: the browser cannot count tags.',
  })
  @ApiOkResponse({ type: [TagCountDto] })
  list(): Promise<TagCountDto[]> {
    return this.tagsService.list();
  }
}
