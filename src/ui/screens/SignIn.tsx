import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { useApp } from '../store';
import { authError, continueOffline, getAuthView, resetPassword, signIn, subscribeAuth } from '../auth';
import { GoogleMark } from '../components/GoogleMark';

/**
 * The door.
 *
 * Three ways in, and they are not equal: Google and a password are accounts
 * that survive this browser, and the anonymous one is an identity that lives in
 * it. All three are one tap, and the anonymous one is deliberately still here —
 * it is what makes "try it now" possible — with the trade said plainly under
 * it, and an offer to link an account later from inside the app.
 *
 * Nobody who already signed in on this device ever sees this screen: Firebase
 * keeps the session, so the gate only stands in front of a genuinely new visit.
 *
 * The exception is a browser carrying an anonymous identity from before this
 * screen existed, when the app still made one on its own. That one is shown the
 * door too — and there "without an account" means the identity already here,
 * models, cars and points included, rather than a fresh one.
 */
type Mode = 'in' | 'up';
type Busy = null | 'google' | 'email' | 'anon' | 'reset';

const MIN_PASSWORD = 6;

export function SignIn() {
  const openInfo = useApp((s) => s.openInfo);
  /** True when an unchosen identity is already sitting in this browser. */
  const inherited = useSyncExternalStore(subscribeAuth, getAuthView).needsDoor;
  const [mode, setMode] = useState<Mode>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /**
   * Set by the failures that are not the visitor's to fix — a provider switched
   * off in the console, a domain that is not authorised, a bad key, or simply
   * no network on a first visit. The app has always run without a cloud, so
   * rather than leave somebody at a door that will not open, offer them that.
   */
  const [stuck, setStuck] = useState(false);

  const attempt = async (what: Exclude<Busy, null>, fn: () => Promise<unknown>) => {
    setBusy(what);
    setError(null);
    setNote(null);
    try {
      await fn();
      // On success the account watcher swaps this whole screen out; there is
      // nothing left to do here.
    } catch (e) {
      const err = authError(e);
      setError(err.message);
      if (
        /configuration-not-found|operation-not-allowed|admin-restricted|unauthorized-domain|api-key|network-request-failed|internal-error/.test(
          err.code,
        )
      ) {
        setStuck(true);
      }
      setBusy(null);
    }
  };

  const submitEmail = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return setError('צריך להקליד כתובת מייל.');
    if (password.length < MIN_PASSWORD) return setError(`הסיסמה קצרה מדי — לפחות ${MIN_PASSWORD} תווים.`);
    void attempt('email', () =>
      mode === 'in' ? signIn.password(email, password) : signIn.register(email, password),
    );
  };

  const forgot = () => {
    if (!email.trim()) return setError('הקלידו קודם את כתובת המייל, ואז לחצו שוב.');
    void attempt('reset', async () => {
      await resetPassword(email);
      setNote('נשלח מייל לאיפוס סיסמה. בדקו גם בספאם.');
      setBusy(null);
    });
  };

  return (
    <div className="signin">
      <div className="signin-card card notched">
        <div className="brand">
          <span className="mark">RL</span>
          <span>ARENA</span>
          <span className="sub">CHAMPIONSHIP</span>
        </div>

        <h1 className="display" style={{ margin: '10px 0 8px' }}>
          מרוץ אחד ביום.
          <br />
          המודלים נוהגים, אתם בונים אותם.
        </h1>
        <p className="muted small" style={{ margin: '0 0 18px' }}>
          מאמנים מודל בדפדפן, רושמים אותו לאליפות, ופעם ביום כל המודלים הרשומים מתחרים ביניהם.
          בחרו איך לשמור את המודלים והנקודות שלכם.
        </p>

        <button className="provider" disabled={busy !== null} onClick={() => void attempt('google', signIn.google)}>
          <GoogleMark />
          {busy === 'google' ? 'מתחבר…' : 'המשך עם Google'}
        </button>

        <div className="auth-or">
          <span>או</span>
        </div>

        <form onSubmit={submitEmail}>
          <div className="field">
            <label htmlFor="auth-email">מייל</label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              dir="ltr"
              value={email}
              placeholder="you@example.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="auth-password">סיסמה</label>
            <input
              id="auth-password"
              type="password"
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="primary wide" type="submit" disabled={busy !== null}>
            {busy === 'email' ? 'רגע…' : mode === 'in' ? 'התחברות' : 'יצירת חשבון'}
          </button>
        </form>

        <div className="row small" style={{ marginTop: 8 }}>
          <button
            className="ghost small"
            disabled={busy !== null}
            onClick={() => {
              setMode(mode === 'in' ? 'up' : 'in');
              setError(null);
              setNote(null);
            }}
          >
            {mode === 'in' ? 'אין לי חשבון — הרשמה' : 'יש לי כבר חשבון'}
          </button>
          <div style={{ flex: 1 }} />
          {mode === 'in' && (
            <button className="ghost small" disabled={busy !== null} onClick={forgot}>
              {busy === 'reset' ? 'שולח…' : 'שכחתי סיסמה'}
            </button>
          )}
        </div>

        {error && (
          <div className="auth-note warn" role="alert">
            {error}
          </div>
        )}
        {note && <div className="auth-note good">{note}</div>}

        <div className="auth-or">
          <span>או</span>
        </div>

        <button className="wide" disabled={busy !== null} onClick={() => void attempt('anon', signIn.anonymous)}>
          {busy === 'anon' ? 'נכנס…' : inherited ? 'המשך בלי חשבון' : 'כניסה מהירה בלי חשבון'}
        </button>
        <p className="tiny dim" style={{ margin: '8px 0 0' }}>
          {inherited ? (
            <>
              בדפדפן הזה כבר יושבת זהות אנונימית, והכפתור הזה ממשיך <b>איתה</b> — עם המודלים,
              הרכבים והנקודות שצברה. היא חיה בדפדפן הזה בלבד, וניקוי נתוני הדפדפן מוחק אותה.
              אם יש לכם חשבון, התחברו אליו למעלה במקום.
            </>
          ) : (
            <>
              בלי חשבון אין מה למלא ואף פרט לא נשמר — אבל הזהות חיה בדפדפן הזה בלבד, וניקוי
              נתוני הדפדפן מוחק אותה. אפשר לקשר אליה Google או מייל מאוחר יותר, בלי לאבד מודלים
              או נקודות.
            </>
          )}
        </p>

        {stuck && (
          <div className="auth-note" style={{ marginTop: 14 }}>
            <p style={{ margin: '0 0 8px' }} className="small">
              אפשר גם להיכנס בלי ענן. האימון, המוסך והמשחק עובדים במלואם; מה שלא יעבוד הוא
              האליפות המשותפת, והמודלים יישמרו בדפדפן הזה בלבד.
            </p>
            <button className="small" onClick={continueOffline}>
              המשך בלי ענן
            </button>
          </div>
        )}

        <div className="auth-foot">
          <button className="ghost small" onClick={() => openInfo('how')}>
            איך זה עובד
          </button>
          <span className="dim">·</span>
          <button className="ghost small" onClick={() => openInfo('terms')}>
            תנאי שימוש
          </button>
          <span className="dim">·</span>
          <button className="ghost small" onClick={() => openInfo('privacy')}>
            פרטיות
          </button>
        </div>
      </div>
    </div>
  );
}
