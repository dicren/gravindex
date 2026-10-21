import type { Tag } from '#/domain/tags/tag.entity';
import { foldForSearch } from './fold-accents';

/**
 * What a tag autocomplete should offer, given everything that exists and what
 * the visitor has typed so far.
 *
 * The suggestion rule: a case- and accent-insensitive **substring** match (not a prefix — `nécdo`
 * finds `Anécdotas`), minus whatever is already selected so the list never
 * suggests something that is right there on screen.
 *
 * It is a plain function and not a computed inside the component so that the
 * accent rule can be asserted directly — it is the one piece of this widget
 * that is easy to lose in a refactor and impossible to notice by looking.
 */
export function filterTags(
  all: readonly Tag[],
  query: string,
  exclude: readonly Tag[] = [],
): Tag[] {
  const needle = foldForSearch(query);
  return all.filter((tag) => foldForSearch(tag).includes(needle) && !exclude.includes(tag));
}
