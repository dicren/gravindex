import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { StrictIntPipe } from '../common/validation/strict-int';
import { User } from '../database/entities/User.entity';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { CurrentAdmin } from './current-admin.decorator';
import { AdminClipDto, AdminIdentityDto } from './dto/admin.dto';
import { DeleteTagQueryDto, RenameTagDto } from './dto/tag.dto';
import { UpdateClipDto } from './dto/update-clip.dto';

/**
 * Everything behind a login, under one prefix.
 *
 * ⚠️ `/api/admin/...` is a SEPARATE surface, not a set of extra verbs bolted
 * onto `/api/clips`. The public routes are a published contract;
 * these are new and free to have a sane shape. Keeping them apart also keeps
 * the guard's blast radius readable: one `@UseGuards` at the class, and every
 * route it covers is in this file.
 *
 * ⚠️ The class-level guard is what makes "did I remember to protect this one?"
 * a question nobody has to ask when adding a route here.
 *
 * ⚠️ `StrictIntPipe`, not Nest's `ParseIntPipe`: the latter reads `1e1` as 1,
 * `1.5` as 1 and `0x2` as 0, so `PATCH /admin/clips/1e1` would silently edit a
 * clip whose id is not in the URL. The public routes reject those spellings
 * (`common/validation/strict-int.ts`) and there is no reason for the admin
 * surface to be the lenient one.
 */
@ApiTags('admin')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing, malformed or expired admin token.' })
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /**
   * "Is the token this browser has been keeping still good?" — the probe an
   * admin screen runs on mount. It exists because the answer is otherwise
   * unknowable without attempting a destructive call: a 12 h token can expire,
   * and deleting the `user` row invalidates it immediately.
   */
  @Get('me')
  @ApiOkResponse({ type: AdminIdentityDto })
  me(@CurrentAdmin() admin: User): AdminIdentityDto {
    return AdminIdentityDto.from(admin);
  }

  @Get('clips/:id')
  @ApiOkResponse({ type: AdminClipDto })
  @ApiNotFoundResponse({ description: 'No clip with that id.' })
  getClip(@Param('id', StrictIntPipe) id: number): Promise<AdminClipDto> {
    return this.adminService.getClip(id);
  }

  @Patch('clips/:id')
  @ApiOkResponse({ type: AdminClipDto })
  @ApiNotFoundResponse({ description: 'No clip with that id.' })
  updateClip(
    @Param('id', StrictIntPipe) id: number,
    @Body() dto: UpdateClipDto,
    @CurrentAdmin() admin: User,
  ): Promise<AdminClipDto> {
    return this.adminService.updateClip(id, dto, admin.username);
  }

  // ⚠️ Not a `DELETE` on one row — see `AdminService.deleteClip` for why it is
  // a transaction and why the id it frees is never reused.
  @Delete('clips/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'The clip and all its votes, plays and tags are gone.' })
  @ApiNotFoundResponse({ description: 'No clip with that id.' })
  deleteClip(@Param('id', StrictIntPipe) id: number, @CurrentAdmin() admin: User): Promise<void> {
    return this.adminService.deleteClip(id, admin.username);
  }

  @Patch('clips/:id/tags')
  @ApiOkResponse({ type: AdminClipDto })
  @ApiNotFoundResponse({ description: 'No such clip, or the clip does not carry that tag.' })
  @ApiConflictResponse({ description: 'The clip already carries the new tag.' })
  renameTag(
    @Param('id', StrictIntPipe) id: number,
    @Body() dto: RenameTagDto,
    @CurrentAdmin() admin: User,
  ): Promise<AdminClipDto> {
    return this.adminService.renameTag(id, dto, admin.username);
  }

  // ⚠️ The tag is a QUERY parameter, never a path segment: tags are free text
  // and one containing a `/` would silently become a different route. See
  // `dto/tag.dto.ts`.
  @Delete('clips/:id/tags')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'The tag is off this clip.' })
  @ApiNotFoundResponse({ description: 'The clip does not carry that tag.' })
  deleteTag(
    @Param('id', StrictIntPipe) id: number,
    @Query() query: DeleteTagQueryDto,
    @CurrentAdmin() admin: User,
  ): Promise<void> {
    return this.adminService.deleteTag(id, query.tag, admin.username);
  }
}
