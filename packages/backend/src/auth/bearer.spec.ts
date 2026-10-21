import { UnauthorizedException } from '@nestjs/common';
import { bearerFrom, requireBearer } from './bearer';

// One parser, one answer: three hand-rolled parsers drift apart and the same
// header authenticates one route while being invisible to another.
describe('bearer', () => {
  it('reads a well-formed header', () => {
    expect(bearerFrom('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  // RFC 7235 makes the scheme token case-insensitive, so accepting only
  // `Bearer` would refuse a legitimate client.
  it('accepts any casing of the scheme and trims the token', () => {
    expect(bearerFrom('bearer   abc  ')).toBe('abc');
    expect(bearerFrom('BEARER\tabc')).toBe('abc');
  });

  it('rejects everything that is not a bearer header', () => {
    expect(bearerFrom(undefined)).toBeUndefined();
    expect(bearerFrom('')).toBeUndefined();
    expect(bearerFrom('abc.def.ghi')).toBeUndefined();
    expect(bearerFrom('Basic dXNlcjpwYXNz')).toBeUndefined();
    expect(bearerFrom('Bearer')).toBeUndefined();
    expect(bearerFrom('Bearer   ')).toBeUndefined();
    // ⚠️ The anonymous voter token is not a credential and never travels in
    // this header — but if someone ever pasted one in raw, it is not a bearer.
    expect(bearerFrom('11111111-2222-3333-4444-555555555555')).toBeUndefined();
  });

  it('requireBearer turns an absent token into a 401', () => {
    expect(() => requireBearer(undefined, 'nope')).toThrow(UnauthorizedException);
    expect(requireBearer('Bearer abc', 'nope')).toBe('abc');
  });
});
