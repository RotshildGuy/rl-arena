import { getLang, type Lang } from './lang';
import { he } from './he';
import { en } from './en';

/**
 * Every string the app shows, in one language. The Hebrew dictionary is the
 * reference: the English one is typed against it, so a key missing from either
 * side fails `npm run typecheck`. Most entries are plain strings; the ones with
 * something to fill in are functions, and a few that carry markup are elements.
 *
 * This module has no React in it, so `core/` and the workers can read it too.
 */
export type Dict = typeof he;

const DICTS: Record<Lang, Dict> = { he, en };

/** The current language's strings, for code outside React (and inside callbacks). */
export function t(): Dict {
  return DICTS[getLang()];
}

/**
 * Turns the fields `words` returns into getters on `base`, read in the current
 * language each time. For the constant tables in `core/` (reward sliders,
 * algorithms, shop items): their consumers keep reading `.label` as before, and
 * get the language that is on now rather than the one the module loaded in.
 */
export function translated<B extends object, W extends object>(base: B, words: () => W): B & W {
  for (const key of Object.keys(words())) {
    Object.defineProperty(base, key, {
      get: () => (words() as Record<string, unknown>)[key],
      enumerable: true,
      configurable: true,
    });
  }
  return base as B & W;
}
