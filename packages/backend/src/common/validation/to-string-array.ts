// Normalises a query-string value that is *meant* to be a list into one.
//
// ⚠️ Why this is needed at all: express 5's default query parser is `simple`
// (node's `querystring`), not the `extended` (`qs`) parser express 4 used. Two
// consequences must be handled:
//
//   - `?tags[]=a&tags[]=b` arrives under the LITERAL key `tags[]`, not folded
//     back into `tags` — and `tags[]=` is what axios' default serialiser has
//     always emitted, so it is the shape every existing link and bookmark uses;
//   - a single occurrence (`?tags[]=a`) arrives as a STRING, not a one-element
//     array. A string passes a `.length > 0` check and then filters on
//     `query.tags[0]` — the single character `'A'` — returning zero results and
//     no error.
export function toStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const items = Array.isArray(value) ? value : [value];

  return items.filter((item) => item !== undefined && item !== null).map((item) => String(item));
}

// Order-preserving de-duplication. The tag filter is an AND over
// `count(distinct tag)`, so `?tags[]=Absurdo&tags[]=Absurdo` would demand two
// distinct matches of one tag and return nothing. De-duping makes a repeated tag
// mean the same as a single one.
export function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}
