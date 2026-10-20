import { useSyncExternalStore } from 'react';
import { getThemePref, setThemePref, subscribeTheme, type ThemePref } from '../theme';

const NEXT: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };
const LOOK: Record<ThemePref, { label: string }> = {
  system: { label: 'לפי המכשיר' },
  light: { label: 'בהיר' },
  dark: { label: 'כהה' },
};

/** Drawn rather than typed: the sun, moon and half-circle glyphs are missing from many fonts. */
function Icon({ pref }: { pref: ThemePref }) {
  const common = { width: 16, height: 16, viewBox: '0 0 24 24', 'aria-hidden': true } as const;
  if (pref === 'light') {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
      </svg>
    );
  }
  if (pref === 'dark') {
    return (
      <svg {...common} fill="currentColor">
        <path d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1Z" />
      </svg>
    );
  }
  return (
    <svg {...common} fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * One quiet button in the header that steps through device → light → dark.
 * Three states on one button rather than a menu: it is a setting people touch
 * once, and the label says which one they are on.
 */
export function ThemeButton() {
  const pref = useSyncExternalStore(subscribeTheme, getThemePref);
  const look = LOOK[pref];
  return (
    <button
      className="ghost small"
      style={{ display: 'inline-flex', alignItems: 'center', padding: '7px 10px' }}
      onClick={() => setThemePref(NEXT[pref])}
      title={`עיצוב: ${look.label} - לחיצה עוברת ל${LOOK[NEXT[pref]].label}`}
      aria-label={`עיצוב: ${look.label}`}
    >
      <Icon pref={pref} />
    </button>
  );
}
