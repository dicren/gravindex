/**
 * Sharing a queue, as a string in a URL — `/cola?c=2D1j0h2s2N`.
 *
 * ⚠️ **Compression, not encryption.** Anyone can decode it, and that is exactly
 * what is wanted: a shared queue is a list of public clip ids, every one of
 * which is already a public permalink. Nothing here hides anything, and nothing
 * here should try to.
 *
 * The scheme:
 *
 * - base62 (`0-9A-Za-z`), **two characters per id**, no separators, in queue
 *   order. `[137, 107, 43, 178, 147]` → `2D1j0h2s2N`.
 * - 10 characters against the 26 of `137%2C107%2C43%2C178%2C147`; twenty clips,
 *   40 against 79. A comma is percent-escaped in a query string and costs three
 *   characters each time.
 * - Two characters cover ids up to **3843**. The largest that exists is 182 and
 *   the sequence advances roughly ten a year, so that is decades of headroom —
 *   and if it is ever reached, a future `c3=` with three-character groups can
 *   live beside `c=` and every old link keeps working. That is why the
 *   parameter is named `c` rather than `queue`.
 * - Decoding is splitting the string into pairs. ⚠️ **Anything that does not
 *   decode is dropped silently**, and so is anything that decodes to an id that
 *   no longer exists (which happens one layer up, when the ids are resolved).
 *   A shared link is a suggestion, not a transaction: refusing the whole queue
 *   because one clip was deleted would be worse for the visitor than quietly
 *   showing the four that are left.
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = ALPHABET.length; // 62
const GROUP = 2;

/** The largest id this encoding can carry: `62² - 1`. */
export const MAX_SHAREABLE_ID = BASE ** GROUP - 1;

/**
 * ⚠️ **Fifty clips, and the cap is deliberate.** A hundred characters is still a
 * link someone can paste into a message; beyond that it is a file pretending to
 * be a link, and browsers, chat clients and QR codes all start disagreeing about
 * how long a URL may be. Queues past the cap share their first fifty.
 */
export const MAX_SHAREABLE_CLIPS = 50;

/** The query parameter. See the note above on why it is one character. */
export const QUEUE_CODE_PARAM = 'c';

/**
 * Ids → code. Ids the encoding cannot carry are skipped rather than truncating
 * the rest, which keeps one impossible id from silently shortening the queue at
 * the point it appears.
 */
export function encodeQueueCode(ids: readonly number[]): string {
  return ids
    .filter((id) => Number.isInteger(id) && id >= 0 && id <= MAX_SHAREABLE_ID)
    .slice(0, MAX_SHAREABLE_CLIPS)
    .map((id) => ALPHABET[Math.floor(id / BASE)]! + ALPHABET[id % BASE]!)
    .join('');
}

/**
 * Code → ids. Never throws: a truncated, edited or hand-typed code yields
 * whatever prefix of it still parses, and duplicates are collapsed because the
 * queue has none.
 */
export function decodeQueueCode(code: string): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();

  // A dangling character at the end is a truncated link, not a zero.
  for (let i = 0; i + GROUP <= code.length; i += GROUP) {
    const high = ALPHABET.indexOf(code[i]!);
    const low = ALPHABET.indexOf(code[i + 1]!);
    if (high === -1 || low === -1) break;

    const id = high * BASE + low;
    // Id 0 does not exist — postgres sequences start at 1 — so a `00` group is
    // a malformed code rather than a clip.
    if (id === 0 || seen.has(id)) continue;

    seen.add(id);
    ids.push(id);
  }

  return ids;
}
