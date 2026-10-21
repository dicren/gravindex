import { ValidationPipeOptions } from '@nestjs/common';

// The exact options `main.ts` registers globally, in one importable place so a
// test can build an app that validates the way production does. ⚠️ Kept in sync
// by hand for now — `main.ts` still spells them out inline; whoever next edits
// that file should import this instead, because a test that validates under
// different options is a test of nothing.
//
//   whitelist              strips properties with no validation decorator;
//   forbidNonWhitelisted   makes an undeclared property a 400 rather than a
//                          silent drop, so a frontend typo is loud;
//   transform + implicit   instantiates the DTO and coerces query/param
//                          strings (`?page=2` is a string on the wire).
export const VALIDATION_PIPE_OPTIONS: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
};
