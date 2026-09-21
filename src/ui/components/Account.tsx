import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { Modal } from './Modal';
import { GoogleMark } from './GoogleMark';
import { useApp } from '../store';
import {
  authError,
  getAuthView,
  isLinked,
  link,
  providerLabel,
  signOutNow,
  subscribeAuth,
  switchAccount,
} from '../auth';

const MIN_PASSWORD = 6;

/**
 * The account, in the header, and never in the way.
 *
 * An anonymous identity works forever and is never nagged about: no banner, no
 * interruption, no dialog that opens by itself. All that is added is one quiet
 * button, so that whoever *does* care that their models live in one browser has
 * somewhere obvious to go. Below 900px it shrinks to its glyph, where the
 * header has room for about three things.
 */
export function AccountButton() {
  const auth = useSyncExternalStore(subscribeAuth, getAuthView);
  const [open, setOpen] = useState(false);
  if (auth.phase !== 'in') return null;

  const linked = isLinked(auth);
  return (
    <>
      <button
        className={`ghost small account-btn${linked ? '' : ' unlinked'}`}
        onClick={() => setOpen(true)}
        title={
          linked
            ? `מחובר${auth.email ? ` כ-${auth.email}` : ''}`
            : 'החשבון שלכם אנונימי וחי בדפדפן הזה בלבד. אפשר לקשר אותו ל-Google או למייל'
        }
      >
        <span className="glyph">{linked ? '👤' : '🔗'}</span>
        <span className="txt">{linked ? 'החשבון שלי' : 'שמירת החשבון'}</span>
      </button>
      {open && <AccountModal onClose={() => setOpen(false)} />}
    </>
  );
}

type Conflict = { kind: 'google' } | { kind: 'password'; email: string; password: string };

/**
 * Everything about the identity, in one dialog: what it is, how to give it a
 * way back in, and how to leave.
 *
 * Linking is the whole point of the screen. It keeps the same uid, so there is
 * nothing to migrate — the models, the cars on the grid and the points are
 * exactly where they were, and the account simply gains a second door.
 */
export function AccountModal({ onClose }: { onClose(): void }) {
  const auth = useSyncExternalStore(subscribeAuth, getAuthView);
  const showToast = useApp((s) => s.showToast);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<null | 'google' | 'email' | 'out'>(null);
  const [error, setError] = useState<string | null>(null);
  /** A Google account or an email that already belongs to somebody else here. */
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [leaving, setLeaving] = useState(false);

  const linked = isLinked(auth);

  const attempt = async (what: 'google' | 'email', fn: () => Promise<unknown>, conflictWith: Conflict) => {
    setBusy(what);
    setError(null);
    setConflict(null);
    try {
      await fn();
      showToast('החשבון קושר — אפשר להתחבר איתו מכל מכשיר');
      onClose();
    } catch (e) {
      const err = authError(e);
      setError(err.message);
      if (/credential-already-in-use|email-already-in-use|account-exists-with-different/.test(err.code)) {
        setConflict(conflictWith);
      }
      setBusy(null);
    }
  };

  const linkEmail = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return setError('צריך להקליד כתובת מייל.');
    if (password.length < MIN_PASSWORD) return setError(`הסיסמה קצרה מדי — לפחות ${MIN_PASSWORD} תווים.`);
    void attempt('email', () => link.password(email, password), { kind: 'password', email, password });
  };

  const leave = async () => {
    setBusy('out');
    setError(null);
    try {
      await signOutNow();
    } catch (e) {
      setError(authError(e).message);
      setBusy(null);
    }
  };

  const takeOver = async () => {
    if (!conflict) return;
    setBusy(conflict.kind === 'google' ? 'google' : 'email');
    setError(null);
    try {
      await switchAccount(
        conflict.kind === 'google' ? 'google' : { email: conflict.email, password: conflict.password },
      );
    } catch (e) {
      setError(authError(e).message);
      setBusy(null);
    }
  };

  return (
    <Modal eyebrow="החשבון שלי" title={linked ? 'החשבון מקושר' : 'החשבון שלכם אנונימי'} onClose={onClose}>
      {linked ? (
        <>
          <p className="small">
            {auth.email ? (
              <>
                מחוברים כ-<b className="mono">{auth.email}</b>.
              </>
            ) : (
              'החשבון מקושר.'
            )}{' '}
            אפשר להתחבר איתו מכל מכשיר ולמצוא את אותם מודלים, אותם רכבים ואותן נקודות.
          </p>
          <p className="small muted">
            דרכי כניסה: {auth.providers.map(providerLabel).join(' · ')}
          </p>
        </>
      ) : (
        <>
          <p className="small">
            הזהות שלכם נוצרה אוטומטית וחיה <b>בדפדפן הזה בלבד</b>. הכל עובד איתה כרגיל, אבל אם
            תנקו את נתוני האתר, תחליפו מכשיר או תפתחו חלון פרטי — אין דרך לחזור אליה, והרכבים
            והנקודות שלכם באליפות יישארו מאחור.
          </p>
          <p className="small muted">
            קישור לחשבון <b>לא מעביר כלום ולא מתחיל מחדש</b>: אותו מזהה, אותם מודלים, אותם רכבים
            על הגריד ואותן נקודות — רק עם דרך חזרה. אפשר גם להמשיך בלי לקשר, ושום דבר לא ישתנה.
          </p>

          <button
            className="provider"
            disabled={busy !== null}
            onClick={() => void attempt('google', link.google, { kind: 'google' })}
          >
            <GoogleMark />
            {busy === 'google' ? 'מקשר…' : 'קשר לחשבון Google'}
          </button>

          <div className="auth-or">
            <span>או</span>
          </div>

          <form onSubmit={linkEmail}>
            <div className="field">
              <label htmlFor="link-email">מייל</label>
              <input
                id="link-email"
                type="email"
                autoComplete="email"
                dir="ltr"
                value={email}
                placeholder="you@example.com"
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="link-password">סיסמה חדשה</label>
              <input
                id="link-password"
                type="password"
                autoComplete="new-password"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button className="primary wide" type="submit" disabled={busy !== null}>
              {busy === 'email' ? 'מקשר…' : 'קשר מייל וסיסמה'}
            </button>
          </form>
        </>
      )}

      {error && (
        <div className="auth-note warn" role="alert">
          {error}
        </div>
      )}

      {conflict && (
        <div className="auth-note" style={{ marginTop: 10 }}>
          <p className="small" style={{ margin: '0 0 8px' }}>
            אפשר להתחבר לחשבון הקיים במקום — אבל <b>הזהות האנונימית הנוכחית תישאר מאחור</b>:
            הרכבים שלה על הגריד והנקודות שצברה יישארו שלה, ואין דרך לחזור אליה. המודלים
            השמורים בדפדפן הזה יעברו איתכם.
          </p>
          <button className="small" disabled={busy !== null} onClick={() => void takeOver()}>
            התחבר לחשבון הקיים
          </button>
        </div>
      )}

      <h3 style={{ margin: '16px 0 6px' }}>יציאה</h3>
      {leaving ? (
        <>
          <p className="small">
            {linked
              ? 'אפשר להתחבר בחזרה בכל רגע עם אותו חשבון.'
              : 'לזהות אנונימית אין דרך חזרה. אחרי יציאה לא תוכלו לחזור אליה, והרכבים והנקודות שלה באליפות יישארו שלה. המודלים השמורים בדפדפן הזה יישארו כאן.'}
          </p>
          <div className="row wrap">
            <button className="danger" disabled={busy !== null} onClick={() => void leave()}>
              {busy === 'out' ? 'יוצא…' : linked ? 'כן, התנתק' : 'כן, צא בכל זאת'}
            </button>
            <button className="ghost" disabled={busy !== null} onClick={() => setLeaving(false)}>
              ביטול
            </button>
          </div>
        </>
      ) : (
        <button className="ghost small" onClick={() => setLeaving(true)}>
          התנתקות מהחשבון
        </button>
      )}
    </Modal>
  );
}
