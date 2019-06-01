import { Controller, Get, Logger, Param, Query } from '@nestjs/common';
import { ParserService } from './parser.service';

@Controller('parser')
export class ParserController {
  private readonly logger = new Logger(ParserController.name);

  constructor(private readonly parserService: ParserService) {}

  @Get('/page/:category/:page')
  async importPage(@Param() params) {
    return await this.parserService.parse(params.category, params.page || 1);
  }

  @Get('main')
  async importMain() {
    return await this.parserService.parse();
  }
}
