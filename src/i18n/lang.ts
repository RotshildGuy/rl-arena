/**
 * Which language the app speaks: Hebrew or English.
 *
 * A first visit takes it from the browser (Hebrew for `he`, English for
 * everything else); a choice made in the settings panel is kept on this device
 * from then on. The choice is applied as `lang` and `dir` on <html>, which is
 * all the stylesheet reads. `index.html` does the same before the first paint,
 * so an English page never flashes right to left while the bundle loads; keep
 * the two in step.
 *
 * Outside a browser (the sanity script) there is nothing to read and nothing
 * to apply, and the language is Hebrew, the one the app was written in.
 */
export type Lang = 'he' | 'en';

const KEY = 'rl-arena-lang';
const inBrowser = typeof document !== 'undefined';
const listeners = new Set<() => void>();

function readLang(): Lang {
  if (!inBrowser) return 'he';
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'he' || v === 'en') return v;
  } catch {
    // Private mode: fall through to the browser's language.
  }
  return (navigator.language || '').toLowerCase().startsWith('he') ? 'he' : 'en';
}

let lang: Lang = readLang();

function apply(): void {
  if (!inBrowser) return;
  const root = document.documentElement;
  root.lang = lang;
  root.dir = lang === 'he' ? 'rtl' : 'ltr';
  listeners.forEach((fn) => fn());
}

export function getLang(): Lang {
  return lang;
}

export function setLang(next: Lang): void {
  lang = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Private mode: the choice holds for this visit only.
  }
  apply();
}

export function subscribeLang(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Call once at startup. */
export function initLang(): void {
  apply();
}

/** The locale dates, times and numbers are written in. */
export function locale(): string {
  return lang === 'he' ? 'he-IL' : 'en-GB';
}
