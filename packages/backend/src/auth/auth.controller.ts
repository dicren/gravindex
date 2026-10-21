import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginResponseDto } from './dto/admin.dto';
import { LoginDto } from './dto/login.dto';

/**
 * The only public route of the admin surface, and the only place in the whole
 * application where a credential is accepted.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ⚠️ 200, not the 201 Nest gives a POST by default: nothing is created here.
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: LoginResponseDto })
  // ⚠️ ONE failure shape for every cause — unknown username, wrong password, a
  // row whose hash was inserted in plaintext. See `AuthService`: the response
  // body, the status AND the response time are deliberately identical, so this
  // endpoint cannot be used to find out which accounts exist.
  @ApiUnauthorizedResponse({ description: 'Invalid username or password.' })
  async login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    const user = await this.authService.validateCredentials(dto.username, dto.password);
    return LoginResponseDto.from(this.authService.issueAdminToken(user), user);
  }
}
