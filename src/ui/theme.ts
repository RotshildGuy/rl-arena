/**
 * Light or dark.
 *
 * By default the app follows the device, and keeps following it - a phone that
 * switches to dark at sunset takes the app with it. Somebody who picks one
 * explicitly gets that one on this browser from then on; picking "device"
 * again hands it back.
 *
 * The choice is applied as `data-theme` on <html>, which is all the stylesheet
 * reads. `index.html` does the same before the first paint, so a light-mode
 * phone never flashes the dark page while the bundle loads; keep the two in step.
 */
export type ThemePref = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

const KEY = 'rl-arena-theme';
const BAR_COLOR: Record<Theme, string> = { dark: '#07080d', light: '#eef1f7' };

const listeners = new Set<() => void>();
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

let pref: ThemePref = readPref();

export function resolveTheme(p: ThemePref, deviceDark: boolean): Theme {
  return p === 'system' ? (deviceDark ? 'dark' : 'light') : p;
}

export function currentTheme(): Theme {
  return resolveTheme(pref, media?.matches ?? true);
}

function apply(): void {
  const theme = currentTheme();
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR_COLOR[theme]);
  listeners.forEach((fn) => fn());
}

export function getThemePref(): ThemePref {
  return pref;
}

export function setThemePref(next: ThemePref): void {
  pref = next;
  try {
    if (next === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // Private mode: the choice holds for this visit only.
  }
  apply();
}

export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Call once at startup: applies the theme and follows the device from then on. */
export function initTheme(): void {
  apply();
  media?.addEventListener('change', () => {
    if (pref === 'system') apply();
  });
}

/** A colour token's current value, for the few things drawn on a canvas. */
export function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
