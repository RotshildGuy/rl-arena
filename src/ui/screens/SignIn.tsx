import { useId, useState, useSyncExternalStore, type FormEvent } from 'react';
import { useApp } from '../store';
import { authError, continueOffline, getAuthView, resetPassword, signIn, subscribeAuth } from '../auth';
import { GoogleMark } from '../components/GoogleMark';
import { SettingsButton } from '../components/SettingsButton';
import { useT } from '../../i18n';

/**
 * The door.
 *
 * Three ways in, and they are not equal: Google and a password are accounts
 * that survive this browser, and the anonymous one is an identity that lives in
 * it. The anonymous one leads - it is what makes "try it now" possible, and a
 * first visitor is far likelier to be trying than returning - with the trade
 * said plainly under it, and an offer to link an account later from inside.
 *
 * Nobody who already signed in on this device ever sees this screen: Firebase
 * keeps the session, so the gate only stands in front of a genuinely new visit.
 *
 * The exception is a browser carrying an anonymous identity from before this
 * screen existed, when the app still made one on its own. That one is shown the
 * door too - and there "without an account" means the identity already here,
 * models, cars and points included, rather than a fresh one.
 */
type Mode = 'in' | 'up';
type Busy = null | 'google' | 'email' | 'anon' | 'reset';

const MIN_PASSWORD = 6;

export function SignIn() {
  const t = useT();
  const s = t.signin;
  const openInfo = useApp((s) => s.openInfo);
  /** True when an unchosen identity is already sitting in this browser. */
  const inherited = useSyncExternalStore(subscribeAuth, getAuthView).needsDoor;
  /**
   * Opening an account is what a newcomer is offered; signing in to one that
   * already exists is a tap away and swaps the same form over. A browser that
   * already holds an identity is likelier to belong to somebody returning.
   */
  const [mode, setMode] = useState<Mode>(() => (getAuthView().needsDoor ? 'in' : 'up'));
  // Ids of its own, so a label names its field even beside another copy of the form.
  const id = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /**
   * Set by the failures that are not the visitor's to fix - a provider switched
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
    if (!email.trim()) return setError(s.needEmail);
    if (password.length < MIN_PASSWORD) return setError(s.shortPassword(MIN_PASSWORD));
    void attempt('email', () =>
      mode === 'in' ? signIn.password(email, password) : signIn.register(email, password),
    );
  };

  const forgot = () => {
    if (!email.trim()) return setError(s.emailFirst);
    void attempt('reset', async () => {
      await resetPassword(email);
      setNote(s.resetSent);
      setBusy(null);
    });
  };

  return (
    <div className="signin">
      <div className="signin-card card notched">
        <div className="row">
          <div className="brand">
            <span className="mark">RL</span>
            <span>ARENA</span>
            <span className="sub">CHAMPIONSHIP</span>
          </div>
          <div style={{ flex: 1 }} />
          {/* Language and theme, before anything else is asked: a newcomer
              whose browser guessed the wrong language has to be able to fix it. */}
          <SettingsButton />
        </div>

        <h1 className="display" style={{ margin: '10px 0 8px' }}>
          {s.headline1}
          <br />
          {s.headline2}
        </h1>
        <p className="muted small" style={{ margin: '0 0 18px' }}>
          {s.intro}
        </p>

        {/* Playing first. Most people arrive to try the thing, not to open an
            account, so the one big button is the way in with nothing to fill.
            Watching the last race is a tap away inside, on the championship
            screen, so it needs no door of its own. Opening an account comes
            next, with signing in one tap away on the same form. The anonymous
            identity can be linked to Google or an e-mail later, keeping
            everything. */}
        <button
          className="primary wide big"
          disabled={busy !== null}
          onClick={() => void attempt('anon', signIn.anonymous)}
        >
          {busy === 'anon' ? s.entering : inherited ? s.continueNoAccount : s.playNow}
        </button>
        <p className="small muted" style={{ margin: '8px 0 0' }}>
          {inherited ? s.inherited : s.noSignup}
        </p>

        <div className="auth-or">
          <span>{s.or}</span>
        </div>

        <h2 style={{ fontSize: 17, margin: '0 0 4px' }}>
          {mode === 'up' ? s.saveProgress : s.signInExisting}
        </h2>
        <p className="small muted" style={{ margin: '0 0 10px' }}>
          {mode === 'up' ? s.anyDevice : s.waiting}
        </p>
        <>
            <button className="provider" disabled={busy !== null} onClick={() => void attempt('google', signIn.google)}>
              <GoogleMark />
              {busy === 'google' ? s.connecting : s.google}
            </button>

            <form onSubmit={submitEmail} style={{ marginTop: 12 }}>
              <div className="field">
                <label htmlFor={`${id}-email`}>{s.email}</label>
                <input
                  id={`${id}-email`}
                  type="email"
                  autoComplete="email"
                  dir="ltr"
                  value={email}
                  placeholder="you@example.com"
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor={`${id}-password`}>{s.password}</label>
                <input
                  id={`${id}-password`}
                  type="password"
                  autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
                  dir="ltr"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <button className="wide" type="submit" disabled={busy !== null}>
                {busy === 'email' ? s.moment : mode === 'in' ? s.signIn : s.createAccount}
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
                {mode === 'in' ? s.toSignUp : s.toSignIn}
              </button>
              <div style={{ flex: 1 }} />
              {mode === 'in' && (
                <button className="ghost small" disabled={busy !== null} onClick={forgot}>
                  {busy === 'reset' ? s.sending : s.forgot}
                </button>
              )}
            </div>
        </>

        {error && (
          <div className="auth-note warn" role="alert">
            {error}
          </div>
        )}
        {note && <div className="auth-note good">{note}</div>}

        {stuck && (
          <div className="auth-note" style={{ marginTop: 14 }}>
            <p style={{ margin: '0 0 8px' }} className="small">
              {s.offline}
            </p>
            <button className="small" onClick={continueOffline}>
              {s.continueOffline}
            </button>
          </div>
        )}

        <div className="auth-foot">
          <button className="ghost small" onClick={() => openInfo('how')}>
            {t.app.footer.how}
          </button>
          <span className="dim">·</span>
          <button className="ghost small" onClick={() => openInfo('terms')}>
            {t.app.footer.terms}
          </button>
          <span className="dim">·</span>
          <button className="ghost small" onClick={() => openInfo('privacy')}>
            {t.app.footer.privacy}
          </button>
        </div>
      </div>
    </div>
  );
}
