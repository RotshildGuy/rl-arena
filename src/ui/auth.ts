import { firebaseConfigured } from '../storage/firebase';
import { disableCloud, setCloudError } from '../storage/cloudStatus';
import { forgetThisBrowser } from './forgetLocal';
import { t } from '../i18n';

/**
 * The account, as the interface needs to know it.
 *
 * Deliberately free of any Firebase import: this module is loaded by the app
 * shell on every visit, and the SDK is half a megabyte that a run without cloud
 * keys must never pay for. Everything that actually talks to Firebase is behind
 * the dynamic import below.
 */
type Sdk = typeof import('../storage/firebaseApp');

function sdk(): Promise<Sdk> {
  return import('../storage/firebaseApp');
}

export type AuthPhase =
  /** No cloud at all - this browser is the whole world, and nothing is gated. */
  | 'off'
  /** Asking Firebase who, if anyone, is already signed in here. */
  | 'loading'
  /** Nobody is. The sign-in screen is up. */
  | 'out'
  | 'in';

export interface AuthView {
  phase: AuthPhase;
  uid: string | null;
  email: string | null;
  /** Signed in, but with an identity that exists only in this browser. */
  anonymous: boolean;
  /** Durable ways back in: `google.com`, `password`. Empty while anonymous. */
  providers: string[];
  /**
   * Signed in with an identity nobody in this browser ever chose - so the door
   * still has to be answered. See `claimIdentity`.
   */
  needsDoor: boolean;
}

const SIGNED_OUT: AuthView = {
  phase: firebaseConfigured ? 'loading' : 'off',
  uid: null,
  email: null,
  anonymous: false,
  providers: [],
  needsDoor: false,
};

/**
 * Whether anybody ever answered the sign-in screen in this browser.
 *
 * Firebase restores whatever session a browser holds, which is right for a
 * session somebody chose and wrong for one they never did: until there was a
 * sign-in screen the app minted an anonymous identity on load, all by itself,
 * and every browser that ever opened the site still carries one. Those browsers
 * would go straight past the door forever - which is exactly how somebody ends
 * up staring at a stranger's empty garage on their own second device,
 * wondering where the account they signed into went.
 *
 * So an anonymous identity that predates this flag is treated as unanswered:
 * the door opens once, and the answer is remembered from then on.
 */
const DOOR_KEY = 'rl-arena.door';

function readDoor(): boolean {
  try {
    return localStorage.getItem(DOOR_KEY) === '1';
  } catch {
    // No storage to remember an answer in - private mode, or storage blocked.
    // Treating it as answered is the safe end: a door that cannot record being
    // answered is a door nobody can ever get through.
    return true;
  }
}

let doorAnswered = readDoor();

/**
 * Take the identity sitting in this browser as mine, without signing in again.
 *
 * Deliberately *not* a new anonymous sign-in: the identity already here may own
 * models, a car on the grid and a season's points, and minting a second one
 * would orphan all of it behind a uid nobody can reach again.
 */
export function claimIdentity(): void {
  if (doorAnswered) return;
  doorAnswered = true;
  try {
    localStorage.setItem(DOOR_KEY, '1');
  } catch {
    // Then it is answered for this session only, which is the best on offer.
  }
  publish({ ...view, needsDoor: false });
}

let view: AuthView = SIGNED_OUT;
const listeners = new Set<() => void>();

function publish(next: AuthView): void {
  const same =
    next.phase === view.phase &&
    next.uid === view.uid &&
    next.email === view.email &&
    next.anonymous === view.anonymous &&
    next.needsDoor === view.needsDoor &&
    next.providers.join(',') === view.providers.join(',');
  // `useSyncExternalStore` compares snapshots by identity, so an unchanged
  // account has to keep handing back the very same object.
  if (same) return;
  view = next;
  listeners.forEach((fn) => fn());
}

export function subscribeAuth(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getAuthView(): AuthView {
  return view;
}

let started = false;

/**
 * Begin watching the account. Safe to call from every render; it only ever
 * attaches once.
 */
export function startAuth(): void {
  if (started || !firebaseConfigured) return;
  started = true;
  void sdk()
    .then(({ watchUser }) =>
      watchUser((user, ready) => {
        if (!ready) return;
        if (!user) {
          publish({ phase: 'out', uid: null, email: null, anonymous: false, providers: [], needsDoor: false });
          return;
        }
        publish({
          phase: 'in',
          uid: user.uid,
          email: user.email,
          anonymous: user.isAnonymous,
          providers: user.providerData.map((p) => p.providerId),
          // An account is its own answer; only an anonymous identity can be one
          // this browser inherited rather than chose.
          needsDoor: user.isAnonymous && !doorAnswered,
        });
      }),
    )
    .catch((err) => {
      // The SDK itself would not load. Nothing is going to sign in, so the app
      // runs local-only rather than sitting on a splash screen forever.
      setCloudError(err);
      publish({ ...SIGNED_OUT, phase: 'off' });
    });
}

/** True once the account has a way back in that outlives this browser profile. */
export function isLinked(v: AuthView): boolean {
  return v.providers.some((p) => p === 'google.com' || p === 'password');
}

export function providerLabel(id: string): string {
  if (id === 'google.com') return 'Google';
  if (id === 'password') return t().authErrors.password;
  return id;
}

// ------------------------------------------------------------------ errors

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

/**
 * Firebase reports everything as a code. Most of them mean one of a handful of
 * things a person can actually do something about, so they are said in those
 * terms - and the few that mean "the project is not set up" name the console
 * screen that fixes them, the same way the cloud badge does.
 */
export function authError(err: unknown): AuthError {
  if (err instanceof AuthError) return err;
  const raw = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string })?.code ?? /\(([\w-]+\/[\w-]+)\)/.exec(raw)?.[1] ?? raw;
  return new AuthError(explain(code, raw), code);
}

function explain(code: string, raw: string): string {
  const is = (...names: string[]) => names.some((n) => code.includes(n));
  const e = t().authErrors;

  if (is('invalid-email')) return e.invalidEmail;
  if (is('missing-password')) return e.missingPassword;
  if (is('weak-password')) return e.weakPassword;
  if (is('email-already-in-use')) return e.emailInUse;
  if (is('invalid-credential', 'wrong-password', 'user-not-found', 'invalid-login'))
    return e.wrongCredentials;
  if (is('user-disabled')) return e.disabled;
  if (is('too-many-requests')) return e.tooMany;
  if (is('popup-closed-by-user', 'cancelled-popup-request', 'user-cancelled'))
    return e.cancelled;
  if (is('popup-blocked'))
    return e.popupBlocked;
  if (is('credential-already-in-use', 'account-exists-with-different-credential'))
    return e.credentialInUse;
  if (is('provider-already-linked')) return e.alreadyLinked;
  if (is('requires-recent-login')) return e.recentLogin;
  if (is('network-request-failed')) return e.network;
  if (is('api-key-not-valid', 'invalid-api-key'))
    return e.apiKey;
  if (is('configuration-not-found'))
    return e.notConfigured;
  if (is('operation-not-allowed', 'admin-restricted-operation'))
    return e.methodOff;
  if (is('unauthorized-domain'))
    return e.domain;
  if (is('operation-not-supported')) return e.noGoogle;
  return raw;
}

async function run<T>(work: (s: Sdk) => Promise<T>): Promise<T> {
  try {
    return await work(await sdk());
  } catch (err) {
    throw authError(err);
  }
}

// ----------------------------------------------------------------- actions

/**
 * Every way through the door, and each of them answers it.
 *
 * "Without an account" is the one with a twist: when this browser already holds
 * an anonymous identity it adopts *that* one instead of minting a second. The
 * person means the same thing either way - carry on with no account - and the
 * version that keeps their models is obviously the one they meant.
 */
export const signIn = {
  anonymous: async () => {
    if (view.phase === 'in' && view.anonymous) return claimIdentity();
    await run((s) => s.signInAnonymous());
    claimIdentity();
  },
  google: async () => {
    await run((s) => s.signInGoogle());
    claimIdentity();
  },
  password: async (email: string, pw: string) => {
    await run((s) => s.signInPassword(email.trim(), pw));
    claimIdentity();
  },
  register: async (email: string, pw: string) => {
    await run((s) => s.signUpPassword(email.trim(), pw));
    claimIdentity();
  },
};

/**
 * Linking keeps the uid, so the models, the cars on the grid and the points all
 * stay put. Nothing here moves data anywhere.
 */
export const link = {
  google: async () => {
    await run((s) => s.linkGoogle());
    claimIdentity();
  },
  password: async (email: string, pw: string) => {
    await run((s) => s.linkPassword(email.trim(), pw));
    claimIdentity();
  },
};

export function resetPassword(email: string): Promise<void> {
  return run((s) => s.sendReset(email.trim()));
}

/**
 * Leaving, and arriving as somebody else, both reload the page.
 *
 * Half the app caches per identity - the model store, the championship state,
 * the race weights - and those caches are module-level on purpose. Rebuilding
 * them by hand at sign-out would be a list that silently goes stale every time
 * a new one is added; a reload cannot.
 */
export async function signOutNow(): Promise<void> {
  await run((s) => s.signOutUser());
  await forgetThisBrowser();
  location.reload();
}

/**
 * Leave this browser's identity behind and open an account that already exists.
 *
 * The way *in* to a second device: Firebase restores whatever session a browser
 * already has, so somebody who once tapped "quick entry" here never sees the door again
 * and would otherwise have no way to say "that account is mine".
 *
 * Signing in is enough on its own - it replaces the current user - and the
 * missing `signOut` is deliberate. Signing out first put two awaits between the
 * tap and `window.open`, which on Safari and on iOS is no longer a user gesture
 * and gets the Google popup blocked; it also flashed the sign-in screen while
 * the popup was still open.
 */
export async function switchAccount(to: 'google' | { email: string; password: string }): Promise<void> {
  await run(async (s) => {
    if (to === 'google') await s.signInGoogle();
    else await s.signInPassword(to.email.trim(), to.password);
  });
  // The account arriving brings its own name and models from the cloud; what
  // this browser held belonged to the identity that was just left behind.
  await forgetThisBrowser();
  location.reload();
}

/**
 * Carry on with no account at all.
 *
 * The escape hatch for a project whose authentication is misconfigured: without
 * it, a console setting nobody can fix from here would leave the app stuck on a
 * sign-in screen that cannot succeed. Training and the garage work offline, so
 * that is where it lands - with the cloud badge saying so.
 */
export function continueOffline(): void {
  // Both halves matter: the switch is what the stores read when they are built,
  // a moment from now, and abandoning is what releases anything already waiting
  // on an identity that is never going to arrive.
  disableCloud();
  void sdk().then((s) => s.abandonCloud());
  publish({ ...SIGNED_OUT, phase: 'off' });
}
