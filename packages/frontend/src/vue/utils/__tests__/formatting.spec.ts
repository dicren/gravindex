import { describe, expect, it } from 'vitest';
import { NetworkError, NotFoundError, RequestRejectedError } from '#/domain/errors';
import { buildEpisodeUrl } from '../episode-url';
import { filterTags } from '../filter-tags';
import { foldAccents, foldForSearch } from '../fold-accents';
import { formatDate, formatDateFull } from '../format-date';
import { formatClipTime } from '../format-time';
import { domainErrorNotice } from '../domain-error-notice';

/**
 * The small pure functions the library screen is built out of. Each one is a
 * behaviour people rely on and that is easy to lose silently in a refactor —
 * a slug spelled differently breaks shared links, an accent-sensitive filter
 * hides a tenth of the tag list, and neither shows up as an error anywhere.
 */

describe('formatClipTime — the player row', () => {
  it('omits the hours field below an hour, which is nearly every clip', () => {
    expect(formatClipTime(0)).toBe('00:00');
    expect(formatClipTime(78)).toBe('01:18');
    expect(formatClipTime(3599)).toBe('59:59');
  });

  it('adds it above an hour, or when a caller needs the columns to line up', () => {
    expect(formatClipTime(3600)).toBe('01:00:00');
    expect(formatClipTime(7270)).toBe('02:01:10');
    expect(formatClipTime(78, true)).toBe('00:01:18');
  });

  it('floors fractional seconds instead of showing 60', () => {
    // `elapsed` comes from an audio element, so it is never a whole number.
    expect(formatClipTime(59.999)).toBe('00:59');
  });

  it('answers --:--:-- for a position before the clip started', () => {
    // Reachable: a stream that has not finished seeking reports a `currentTime`
    // earlier than `clip.start`, so `elapsed` goes negative for a frame.
    expect(formatClipTime(-1)).toBe('--:--:--');
  });
});

describe('formatDate / formatDateFull — episode dates', () => {
  const date = new Date(2009, 3, 12, 10, 30);

  it('prints the compact form the clip card uses', () => {
    expect(formatDate(date)).toBe('12/04/2009');
  });

  it('prints the long form with a CAPITALISED Spanish month', () => {
    // ⚠️ `Intl` in `es-ES` gives "abril"; the site has always shown "Abril".
    expect(formatDateFull(date)).toBe('12 de Abril de 2009');
    expect(formatDateFull(new Date(2020, 0, 3))).toBe('03 de Enero de 2020');
    expect(formatDateFull(new Date(2019, 11, 31))).toBe('31 de Diciembre de 2019');
  });
});

describe('buildEpisodeUrl — links that are already in the wild', () => {
  it('reproduces the frozen algorithm character for character', () => {
    // Invented titles with the shapes the real ones have: accents and
    // punctuation vanish, runs of hyphens are NOT collapsed, and the case is
    // left alone.
    expect(buildEpisodeUrl({ id: 63, title: 'Episodio 12 (Spanish Zombies)' })).toBe(
      '63-Episodio-12-Spanish-Zombies',
    );
    expect(
      buildEpisodeUrl({ id: 60, title: 'Episodio 13 (Qué hacer con los niños en verano)' }),
    ).toBe('60-Episodio-13-Qu-hacer-con-los-nios-en-verano');
    expect(buildEpisodeUrl({ id: 354, title: 'Programa Verité 005 (Institutos)' })).toBe(
      '354-Programa-Verit-005-Institutos',
    );
  });

  it('starts with the id, because the id is the only part anything parses', () => {
    const url = buildEpisodeUrl({ id: 17, title: 'Episodio 134' });
    expect(Number.parseInt(url, 10)).toBe(17);
  });
});

describe('foldAccents — the remove-accents replacement', () => {
  it('folds the accents and the eñe the real tag list actually contains', () => {
    expect(foldAccents('Anécdotas')).toBe('Anecdotas');
    expect(foldAccents('Briñate')).toBe('Brinate');
    expect(foldAccents('Champú')).toBe('Champu');
    expect(foldForSearch('Briñate')).toBe('brinate');
  });

  it('leaves a string with nothing to fold alone', () => {
    expect(foldAccents('Star Wars')).toBe('Star Wars');
  });
});

describe('filterTags — the autocomplete rule', () => {
  const ALL = ['Absurdo', 'Anécdotas', 'Briñate', 'Cine', 'Gazpacho', 'Star Wars'];

  it('matches without accents in either direction', () => {
    expect(filterTags(ALL, 'brinate')).toEqual(['Briñate']);
    expect(filterTags(ALL, 'Briñate')).toEqual(['Briñate']);
    expect(filterTags(ALL, 'anecdotas')).toEqual(['Anécdotas']);
  });

  it('matches a substring, not just a prefix', () => {
    expect(filterTags(ALL, 'necdo')).toEqual(['Anécdotas']);
    expect(filterTags(ALL, 'wars')).toEqual(['Star Wars']);
  });

  it('never suggests something already chosen', () => {
    expect(filterTags(ALL, '', ['Cine', 'Gazpacho'])).toEqual([
      'Absurdo',
      'Anécdotas',
      'Briñate',
      'Star Wars',
    ]);
  });

  it('offers everything when nothing has been typed', () => {
    expect(filterTags(ALL, '')).toEqual(ALL);
  });
});

describe('domainErrorNotice — branching on the code, never on a status', () => {
  it("shows the server's own words when the server refused", () => {
    // The whole point: 400 is the ordinary answer to a user mistake here, and
    // the explanation is the useful half.
    expect(domainErrorNotice(new RequestRejectedError('Tag repeated'))).toEqual({
      level: 'error',
      text: 'Tag repeated',
    });
  });

  it('says something true and Spanish when the request never landed', () => {
    expect(domainErrorNotice(new NetworkError('fetch failed')).text).toBe(
      'No se ha podido conectar con el servidor.',
    );
    // ⚠️ Not the server's message: a transport failure has none worth showing.
    expect(domainErrorNotice(new NetworkError('fetch failed')).text).not.toContain('fetch');
  });

  it('handles a 404 and a thrown non-error alike', () => {
    expect(domainErrorNotice(new NotFoundError('gone')).text).toBe('No hemos encontrado eso.');
    expect(domainErrorNotice('boom').text).toBe('No se ha podido conectar con el servidor.');
  });
});
