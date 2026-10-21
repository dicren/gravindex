import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';

// The anonymous per-browser identity (root AGENTS.md, "Identity"). It is not
// the visitor's IP address. The client generates a UUID once, keeps it in
// `localStorage`, and sends it on writes.
//
// ⚠️ **It is client-supplied, therefore spoofable.** It is a DEDUPLICATION HINT
// and a moderation trail, never proof of who anyone is. Nothing may authorise
// on it. Clearing browser storage defeats it, and that is accepted: the
// catalogue holds a few hundred votes — there is no vote war to defend
// against, and the defence that scales is rate limiting in front of the app,
// which stores nothing.
export const VOTER_TOKEN_HEADER = 'x-voter-token';

// Shape only: 8-4-4-4-12 hex. Deliberately NOT version/variant-strict — a
// client that generates a v7 UUID, or the nil UUID, is not a client bug worth a
// 400. What this DOES enforce is the 36-character budget of the `varchar(36)`
// columns, which is the difference between a 400 and a 500 from postgres.
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RequestWithHeaders {
  headers: Record<string, string | string[] | undefined>;
}

function readToken(ctx: ExecutionContext, required: boolean): string | null {
  const request = ctx.switchToHttp().getRequest<RequestWithHeaders>();
  const raw = request.headers[VOTER_TOKEN_HEADER];
  // Express folds a repeated header into an array. Take the first; a client
  // sending two is broken either way, and the alternative is a 500 downstream.
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (value === undefined || value === '') {
    if (required) {
      throw new BadRequestException(`${VOTER_TOKEN_HEADER} header is required and must be a UUID`);
    }
    return null;
  }

  // ⚠️ Malformed is a 400, never a 500 and never a silent null: a client that
  // sends garbage has a bug, and swallowing it would silently disable the
  // deduplication the caller believes it is getting.
  if (!UUID_SHAPE.test(value)) {
    throw new BadRequestException(`${VOTER_TOKEN_HEADER} header must be a UUID`);
  }

  return value;
}

// Optional: a write that keeps a moderation trail but does not depend on it.
// Missing header -> `null`, stored as NULL: the row simply has no token.
export const VoterToken = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  readToken(ctx, false),
);

// Required: a write whose CONTRACT is unimplementable without it. `POST
// /clips/:id/vote/:value` answers `error: 'you have already voted'`, and that
// answer comes from the `(clip_id, token)` unique constraint — postgres does
// not collide NULLs, so a null token would silently make every repeat vote
// succeed. Better a loud 400 at the one caller than a dedup that quietly is not
// one.
export const RequiredVoterToken = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  readToken(ctx, true),
);
