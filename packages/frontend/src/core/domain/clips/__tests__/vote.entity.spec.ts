import { describe, expect, it } from 'vitest';
import { applyVote, type VoteTally } from '../vote.entity';

const TALLY: VoteTally = { up: 15 };

describe('applyVote', () => {
  it('adds an upvote', () => {
    expect(applyVote(TALLY, { status: 'recorded', added: 1, removed: 0 })).toEqual({ up: 16 });
  });

  it('leaves the counters alone when the vote was refused', () => {
    expect(applyVote(TALLY, { status: 'already-voted' })).toEqual(TALLY);
  });

  it('does not mutate the tally it was given', () => {
    const tally = { up: 1 };
    applyVote(tally, { status: 'recorded', added: 1, removed: 0 });
    expect(tally).toEqual({ up: 1 });
  });

  /**
   * ⚠️ **There is one vote, and it is positive** — the API answers 400 to `-1`.
   *
   * There is nothing to change your mind TO, so what this asserts is that the
   * arithmetic is only ever addition.
   */
  it('can only ever add, because there is only one vote', () => {
    let tally: VoteTally = { up: 0 };
    for (let i = 0; i < 5; i += 1) {
      tally = applyVote(tally, { status: 'recorded', added: 1, removed: 0 });
    }
    expect(tally).toEqual({ up: 5 });
  });
});
