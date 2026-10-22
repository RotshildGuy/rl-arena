import { useSyncExternalStore } from 'react';
import { getLang, subscribeLang, type Lang } from './lang';
import { t, type Dict } from './dict';

export { getLang, setLang, subscribeLang, initLang, locale, type Lang } from './lang';
export { t, translated, type Dict } from './dict';

/** The current language's strings, re-rendering the component when it changes. */
export function useT(): Dict {
  useSyncExternalStore(subscribeLang, getLang);
  return t();
}

/** The current language, re-rendering the component when it changes. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang);
}
