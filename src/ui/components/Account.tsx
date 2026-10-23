import { useId, useState, useSyncExternalStore, type FormEvent } from 'react';
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
import { t, useT } from '../../i18n';

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
  const a = useT().account;
  const auth = useSyncExternalStore(subscribeAuth, getAuthView);
  const [open, setOpen] = useState(false);
  if (auth.phase !== 'in') return null;

  const linked = isLinked(auth);
  return (
    <>
      <button
        className={`ghost small account-btn${linked ? '' : ' unlinked'}`}
        onClick={() => setOpen(true)}
        // A short name for a screen reader - below 900px the words are hidden
        // and only the glyph shows - with the whole explanation on hover.
        aria-label={linked ? a.mine : a.save}
        title={linked ? a.signedInAs(auth.email) : a.anonymousTitle}
      >
        <span className="glyph" aria-hidden="true">{linked ? '👤' : '🔗'}</span>
        <span className="txt">{linked ? a.mine : a.save}</span>
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
 * nothing to migrate - the models, the cars on the grid and the points are
 * exactly where they were, and the account simply gains a second door.
 */
export function AccountModal({ onClose }: { onClose(): void }) {
  const a = useT().account;
  const auth = useSyncExternalStore(subscribeAuth, getAuthView);
  const showToast = useApp((s) => s.showToast);
  const id = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<null | 'google' | 'email' | 'in-google' | 'in-email' | 'out'>(null);
  const [error, setError] = useState<string | null>(null);
  /** A Google account or an email that already belongs to somebody else here. */
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [leaving, setLeaving] = useState(false);
  /** The other door: an account that already exists, on a browser that is anonymous. */
  const [entering, setEntering] = useState(false);
  const [inEmail, setInEmail] = useState('');
  const [inPassword, setInPassword] = useState('');

  const linked = isLinked(auth);

  const attempt = async (what: 'google' | 'email', fn: () => Promise<unknown>, conflictWith: Conflict) => {
    setBusy(what);
    setError(null);
    setConflict(null);
    try {
      await fn();
      showToast(t().account.linkedToast);
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
    if (!email.trim()) return setError(a.needEmail);
    if (password.length < MIN_PASSWORD) return setError(a.shortPassword(MIN_PASSWORD));
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

  /**
   * Open an account that already exists, from a browser that is not it.
   *
   * Nothing is merged - there is no server to merge with - so this says plainly
   * what it costs before it is used.
   */
  const enter = async (how: 'google' | 'email') => {
    if (how === 'email') {
      if (!inEmail.trim()) return setError(a.needEmail);
      if (!inPassword) return setError(a.needPassword);
    }
    setBusy(how === 'google' ? 'in-google' : 'in-email');
    setError(null);
    setConflict(null);
    try {
      // On success the page reloads into the other account; nothing returns here.
      await switchAccount(how === 'google' ? 'google' : { email: inEmail, password: inPassword });
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
    <Modal eyebrow={a.mine} title={linked ? a.linkedTitle : a.anonymousHeading} onClose={onClose}>
      {linked ? (
        <>
          <p className="small">
            {auth.email ? a.connectedAs(auth.email) : a.linked} {a.anyDevice}
          </p>
          <p className="small muted">
            {a.ways} {auth.providers.map(providerLabel).join(' · ')}
          </p>
        </>
      ) : (
        <>
          <p className="small">{a.anonymousBody}</p>
          <p className="small muted">{a.linkBody}</p>

          <button
            className="provider"
            disabled={busy !== null}
            onClick={() => void attempt('google', link.google, { kind: 'google' })}
          >
            <GoogleMark />
            {busy === 'google' ? a.linking : a.linkGoogle}
          </button>

          <div className="auth-or">
            <span>{a.or}</span>
          </div>

          <form onSubmit={linkEmail}>
            <div className="field">
              <label htmlFor={`${id}-link-email`}>{a.email}</label>
              <input
                id={`${id}-link-email`}
                type="email"
                autoComplete="email"
                dir="ltr"
                value={email}
                placeholder="you@example.com"
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor={`${id}-link-password`}>{a.newPassword}</label>
              <input
                id={`${id}-link-password`}
                type="password"
                autoComplete="new-password"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button className="primary wide" type="submit" disabled={busy !== null}>
              {busy === 'email' ? a.linking : a.linkEmail}
            </button>
          </form>

          <h3 style={{ margin: '18px 0 6px' }}>{a.haveAccount}</h3>
          {entering ? (
            <>
              <p className="small">{a.switchWarning}</p>
              <button className="provider" disabled={busy !== null} onClick={() => void enter('google')}>
                <GoogleMark />
                {busy === 'in-google' ? a.signingIn : a.signInGoogle}
              </button>
              <div className="auth-or">
                <span>{a.or}</span>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void enter('email');
                }}
              >
                <div className="field">
                  <label htmlFor={`${id}-in-email`}>{a.email}</label>
                  <input
                    id={`${id}-in-email`}
                    type="email"
                    autoComplete="email"
                    dir="ltr"
                    value={inEmail}
                    placeholder="you@example.com"
                    onChange={(e) => setInEmail(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`${id}-in-password`}>{a.password}</label>
                  <input
                    id={`${id}-in-password`}
                    type="password"
                    autoComplete="current-password"
                    dir="ltr"
                    value={inPassword}
                    onChange={(e) => setInPassword(e.target.value)}
                  />
                </div>
                <button className="primary wide" type="submit" disabled={busy !== null}>
                  {busy === 'in-email' ? a.signingIn : a.signIn}
                </button>
              </form>
              <button
                className="ghost small"
                style={{ marginTop: 8 }}
                disabled={busy !== null}
                onClick={() => setEntering(false)}
              >
                {a.cancel}
              </button>
            </>
          ) : (
            <>
              <p className="small muted">{a.otherDevice}</p>
              <button
                className="wide"
                disabled={busy !== null}
                onClick={() => {
                  setEntering(true);
                  setError(null);
                  setConflict(null);
                }}
              >
                {a.signInExisting}
              </button>
            </>
          )}
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
            {a.conflict}
          </p>
          <button className="small" disabled={busy !== null} onClick={() => void takeOver()}>
            {a.takeOver}
          </button>
        </div>
      )}

      <h3 style={{ margin: '16px 0 6px' }}>{a.leave}</h3>
      {leaving ? (
        <>
          <p className="small">
            {linked ? a.leaveLinked : a.leaveAnonymous}
          </p>
          <div className="row wrap">
            <button className="danger" disabled={busy !== null} onClick={() => void leave()}>
              {busy === 'out' ? a.leaving : a.confirmLeave}
            </button>
            <button className="ghost" disabled={busy !== null} onClick={() => setLeaving(false)}>
              {a.cancel}
            </button>
          </div>
        </>
      ) : (
        <button className="ghost small" onClick={() => setLeaving(true)}>
          {a.signOut}
        </button>
      )}
    </Modal>
  );
}
