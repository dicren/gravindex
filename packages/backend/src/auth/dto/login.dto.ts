import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// ⚠️ The global `ValidationPipe` runs with `forbidNonWhitelisted`, so every
// property a client may send has to be declared AND decorated here — an
// undecorated field is stripped, an undeclared one is a 400.
export class LoginDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  username!: string;

  // ⚠️ Bounded, and not for tidiness: bcrypt's cost is paid on the server, and
  // an unbounded body would let anyone burn CPU at will on an endpoint with no
  // rate limiting in front of it. bcrypt itself only reads the first 72 bytes.
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password!: string;
}
