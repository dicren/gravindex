import { MikroORM } from '@mikro-orm/core';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { defineConfig } from '@mikro-orm/postgresql';
import { Clip } from './Clip.entity';
import { Episode } from './Episode.entity';
import { Playback } from './Playback.entity';
import { Tag } from './Tag.entity';
import { Vote } from './Vote.entity';

// Metadata only. ⚠️ **No database is contacted**, and the `host`/`port` below
// are deliberately unreachable to prove it: MikroORM 7 connects lazily, so
// discovery runs on the decorators alone, so no live database is needed.
//
// What this guards is the handful of schema properties that are DECISIONS
// rather than preferences — each one something a later change could quietly
// undo with nothing else complaining.
//
// ⚠️ Each entity is looked up by its own class rather than through a shared
// helper: `MetadataStorage.get` is generic over ONE entity type, so a union of
// the five constructors makes TypeScript pick the first and reject the rest.
describe('entity metadata', () => {
  let orm: MikroORM;
  let propertyNames: {
    Episode: string[];
    Clip: string[];
    Tag: string[];
    Vote: string[];
    Playback: string[];
  };

  beforeAll(async () => {
    orm = await MikroORM.init(
      defineConfig({
        metadataProvider: ReflectMetadataProvider,
        entities: [Episode, Clip, Tag, Vote, Playback],
        dbName: 'gravindex-metadata-only',
        host: '127.0.0.1',
        port: 1,
        allowGlobalContext: true,
        discovery: { warnWhenNoEntities: false },
      }),
    );
    const metadata = orm.getMetadata();
    propertyNames = {
      Episode: Object.keys(metadata.get(Episode).properties),
      Clip: Object.keys(metadata.get(Clip).properties),
      Tag: Object.keys(metadata.get(Tag).properties),
      Vote: Object.keys(metadata.get(Vote).properties),
      Playback: Object.keys(metadata.get(Playback).properties),
    };
  });

  afterAll(async () => {
    await orm.close(true);
  });

  // ⚠️ No entity stores an IP, and it is not softened into a hash or kept
  // "just for moderation". A database with zero personal data in it is the
  // point.
  it('no entity stores an IP', () => {
    // ⚠️ Case-SENSITIVE and anchored on a word boundary on purpose: a naive
    // `/ip$/i` matches `clip`, which is every relation in this schema.
    // This catches `ip`, `user_ip` and `submitterIp`, and nothing else.
    const looksLikeAnIp = (name: string) => /(^|_)ip$/.test(name) || /[a-z]Ip$/.test(name);
    const offenders = Object.entries(propertyNames).map(([entity, names]) => [
      entity,
      names.filter(looksLikeAnIp),
    ]);

    expect(offenders).toEqual([
      ['Episode', []],
      ['Clip', []],
      ['Tag', []],
      ['Vote', []],
      ['Playback', []],
    ]);
  });

  // The anonymous token is identity — everywhere EXCEPT playback, which has no
  // identity column at all because nothing ever read it back.
  it('clip, tag and vote carry a nullable anonymous token', () => {
    const metadata = orm.getMetadata();

    expect(metadata.get(Clip).properties.token.nullable).toBe(true);
    expect(metadata.get(Tag).properties.token.nullable).toBe(true);
    expect(metadata.get(Vote).properties.token.nullable).toBe(true);
  });

  it('playback has no identity column at all', () => {
    expect(propertyNames.Playback).toEqual(['id', 'clip', 'createdAt']);
  });

  // A tag IS the (clip, tag) pair. There is no tag table and no surrogate id.
  it('tag is keyed by the (clip, tag) pair', () => {
    expect(orm.getMetadata().get(Tag).primaryKeys).toEqual(['clip', 'tag']);
  });

  // Integer seconds, and the frontend's editor sends them as such.
  it('clip start and end are integer seconds', () => {
    const clip = orm.getMetadata().get(Clip);

    expect(clip.properties.start.type).toBe('number');
    expect(clip.properties.end.type).toBe('number');
  });

  // ⚠️ Every foreign key restricts on delete: removing a clip is a transaction,
  // not a `DELETE`. The admin has to decide that explicitly.
  it('every foreign key cascades on update and restricts on delete', () => {
    const metadata = orm.getMetadata();
    const rules = [
      metadata.get(Clip).properties.episode,
      metadata.get(Tag).properties.clip,
      metadata.get(Vote).properties.clip,
      metadata.get(Playback).properties.clip,
    ].map(({ updateRule, deleteRule }) => ({ updateRule, deleteRule }));

    expect(rules).toEqual(Array(4).fill({ updateRule: 'cascade', deleteRule: 'restrict' }));
  });

  // `lazy` here: never selected, never serialized,
  // unless a query explicitly asks. Neither has ever been surfaced in the UI.
  it('episode.description and clip.createdAt stay lazy', () => {
    const metadata = orm.getMetadata();

    expect(metadata.get(Episode).properties.description.lazy).toBe(true);
    expect(metadata.get(Clip).properties.createdAt.lazy).toBe(true);
  });
});
