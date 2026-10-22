import { useState, useSyncExternalStore } from 'react';
import { getThemePref, setThemePref, subscribeTheme, type ThemePref } from '../theme';
import { setLang, useLang, useT, type Lang } from '../../i18n';
import { Modal } from './Modal';

const THEMES: ThemePref[] = ['system', 'light', 'dark'];

/** Each language by its own name, so somebody who cannot read the other one still finds theirs. */
const LANGS: Array<{ id: Lang; name: string }> = [
  { id: 'he', name: 'עברית' },
  { id: 'en', name: 'English' },
];

/** Drawn rather than typed: a gear glyph is missing from many fonts. */
function Gear() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  );
}

/**
 * One quiet button in the header for the two things people set once per device:
 * light or dark, and the language. Both choices are kept in this browser
 * (`ui/theme.ts`, `i18n/lang.ts`) and take effect at once, without a reload.
 */
export function SettingsButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const pref = useSyncExternalStore(subscribeTheme, getThemePref);
  const lang = useLang();
  const s = t.app.settings;
  return (
    <>
      <button
        className="ghost small"
        style={{ display: 'inline-flex', alignItems: 'center', padding: '7px 10px' }}
        onClick={() => setOpen(true)}
        title={s.button}
        aria-label={s.button}
        aria-haspopup="dialog"
      >
        <Gear />
      </button>
      {open && (
        <Modal title={s.title} onClose={() => setOpen(false)}>
          <div className="settings">
            <div className="settings-row">
              <div className="label">{s.theme}</div>
              <div className="segmented" role="radiogroup" aria-label={s.theme}>
                {THEMES.map((p) => (
                  <button key={p} className={pref === p ? 'on' : ''} role="radio" aria-checked={pref === p} onClick={() => setThemePref(p)}>
                    {s[p]}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-row">
              <div className="label">{s.language}</div>
              <div className="segmented" role="radiogroup" aria-label={s.language}>
                {LANGS.map((l) => (
                  <button
                    key={l.id}
                    className={lang === l.id ? 'on' : ''}
                    role="radio"
                    aria-checked={lang === l.id}
                    lang={l.id}
                    onClick={() => setLang(l.id)}
                  >
                    {l.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="small muted">{s.saved}</div>
          </div>
        </Modal>
      )}
    </>
  );
}
