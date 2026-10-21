import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { APP_VERSION } from '../../constants/version';
import { HealthResponseDto } from './health.dto';

// The one endpoint that exists from day one: something to `curl` that proves the
// process is up and answering under the `/api` prefix. Deliberately does NOT
// touch the database — a liveness probe that fails when postgres hiccups tells
// you less, not more.
@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Liveness probe and version' })
  @ApiOkResponse({ type: HealthResponseDto })
  check(): HealthResponseDto {
    return { status: 'ok', version: APP_VERSION, time: new Date().toISOString() };
  }
}
