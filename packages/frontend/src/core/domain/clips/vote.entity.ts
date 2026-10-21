/**
 * Voting, as the domain sees it.
 *
 * ⚠️ Read `POST /clips/:id/vote/:value`'s contract before changing anything
 * here: a repeated vote is **not** an HTTP error. The backend answers the
 * ordinary 201 with `error: 'you have already voted'`, and the UI has to branch
 * on that string. So the outcome of a vote is a value with two shapes, not a
 * promise that either resolves or throws — a caller cannot accidentally read
 * "already voted" as success, because the successful shape is the only one
 * carrying `added`.
 *
 * ⚠️ **There is one vote, and it is positive.** The API answers 400 to `-1`,
 * so a negative value cannot be typed here or written anywhere.
 */

/** The only value the API accepts. A `number` here would make a 400 reachable. */
export type VoteValue = 1;

/**
 * What every screen displays. ⚠️ Present on all three clip shapes: the permalink
 * needs it to show the vote button there and in the global player.
 */
export interface VoteTally {
  readonly up: number;
}

/**
 * The library's rows add `points`, the default sort key.
 *
 * ⚠️ It is the same number as `up`, always, and it survives as its own field
 * for one reason: `order=points` travels in every library link ever shared, so
 * the name has to keep meaning something. Renaming it breaks those URLs;
 * dropping it makes a row disagree with the control that sorted it.
 */
export interface VoteCounts extends VoteTally {
  readonly points: number;
}

/**
 * The result of casting a vote.
 *
 * `recorded` carries what the server actually did. ⚠️ `removed` is always `0`
 * now — "changing your mind" needed a second value to change to — and the field
 * stays because it is what the server sends and what `applyVote` is arithmetic
 * over. The UI adjusts its counters from these rather than refetching, which
 * `packages/frontend/AGENTS.md` calls out as behaviour that must survive.
 */
export type VoteOutcome =
  | { readonly status: 'recorded'; readonly added: VoteValue; readonly removed: 0 }
  | { readonly status: 'already-voted' };

/**
 * The counter update, as one pure function instead of arithmetic spread through
 * a template.
 *
 * ⚠️ Not a prediction: `added` is what the server reported storing, so this is
 * arithmetic on a known result and nothing here ever needs rolling back. A
 * repeated vote arrives as `already-voted` and correctly changes nothing.
 */
export function applyVote(tally: VoteTally, outcome: VoteOutcome): VoteTally {
  if (outcome.status === 'already-voted') {
    return tally;
  }
  return { up: tally.up + outcome.added };
}
