import { TAGS_QUERY } from './tags.sql';

// No database. The one thing this query has to get right that a reader cannot
// see at a glance is the collation, so that is what is asserted here; the order
// it actually produces is asserted against real postgres in the integration
// suite.

describe('TAGS_QUERY', () => {
  it('groups the tag join table, which is what lets it count', () => {
    expect(TAGS_QUERY).toContain('from "tag"');
    expect(TAGS_QUERY).toContain('group by 1');
    // ⚠️ The count is the point of this query: the endpoint answers
    // `{ tag, count }`, not a flat `string[]`. `::int` because postgres' `count`
    // is a bigint, which the driver hands over as a STRING.
    expect(TAGS_QUERY).toContain('count(*)::int as "count"');
  });

  // ⚠️ The bare `order by "tag"` would inherit the database's collation
  // (`en_US.utf8` here), which is a LINGUISTIC sort and puts `after nigth`
  // first. `collate "C"` is code-point order, which is the order the API promises.
  it('sorts by code point, not by the database collation', () => {
    expect(TAGS_QUERY).toContain('collate "C"');
    expect(TAGS_QUERY).toContain('order by 1');
    // The collation must be on the SELECTed expression, or postgres rejects the
    // statement next to the grouping.
    expect(TAGS_QUERY).toContain('select "tag" collate "C" as "tag"');
  });

  it('takes no parameters, so there is nothing to bind and nothing to inject', () => {
    expect(TAGS_QUERY).not.toContain('?');
  });
});
