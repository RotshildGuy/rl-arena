import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  linkWithCredential,
  linkWithPopup,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { firebaseConfig, firebaseConfigured } from './firebase';

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

/**
 * One Firebase app for the whole session. Both the private model store and the
 * shared championship arena go through here, so they share a single identity
 * instead of racing each other to create one.
 */
export function ensureApp(): { auth: Auth; db: Firestore } {
  if (!firebaseConfigured) throw new Error('Firebase is not configured');
  if (!app) {
    app = initializeApp(firebaseConfig as Record<string, string>);
    auth = getAuth(app);
    db = getFirestore(app);
  }
  return { auth: auth!, db: db! };
}

// ---------------------------------------------------------------- identity

/**
 * Who is signed in, as Firebase last reported it.
 *
 * Signing in is a choice now — Google, an email and password, or an anonymous
 * identity — so nothing here starts a session on its own. The UI gate does
 * that, and everything underneath simply waits for an identity to exist.
 */
let user: User | null = null;
/** Whether Firebase has answered at all. "Nobody is signed in" is an answer. */
let ready = false;
/** Set when the app gives up on the cloud, so waiting calls stop waiting. */
let abandoned = false;
let observing = false;

type Watcher = (user: User | null, ready: boolean) => void;
const watchers = new Set<Watcher>();
const waiting: Array<{ resolve: (u: User) => void; reject: (e: Error) => void }> = [];

function notify(): void {
  for (const fn of watchers) fn(user, ready);
}

function observe(): void {
  if (observing) return;
  observing = true;
  const { auth } = ensureApp();
  onAuthStateChanged(
    auth,
    (u) => {
      user = u;
      ready = true;
      if (u) {
        // Everything that was blocked on an identity can run now.
        while (waiting.length) waiting.pop()!.resolve(u);
      }
      notify();
    },
    (err) => {
      // Authentication itself is broken — usually a console setting. Failing
      // the waiting calls is what turns it into a message on screen instead of
      // a library that never finishes loading.
      ready = true;
      const error = err instanceof Error ? err : new Error(String(err));
      while (waiting.length) waiting.pop()!.reject(error);
      notify();
    },
  );
}

/** Subscribe to the signed-in user. Fires immediately with what is known now. */
export function watchUser(fn: Watcher): () => void {
  watchers.add(fn);
  observe();
  fn(user, ready);
  return () => {
    watchers.delete(fn);
  };
}

/**
 * The identity models are owned by.
 *
 * Resolves as soon as somebody is signed in and waits patiently until then —
 * the stores are built before the sign-in screen is answered, and a store that
 * throws because the answer has not arrived yet would turn a normal first visit
 * into an error. `abandonCloud` is the way out when there will be no answer.
 */
export function currentUser(): Promise<User> {
  if (user) return Promise.resolve(user);
  if (abandoned) return Promise.reject(new Error('(auth/no-user) אין חשבון מחובר'));
  observe();
  return new Promise<User>((resolve, reject) => {
    waiting.push({ resolve, reject });
  });
}

/**
 * Stop waiting for an identity.
 *
 * Called when someone chooses to carry on without the cloud after sign-in
 * failed. Without it every cloud read would hang on a promise that is never
 * going to settle, and the championship screen would load forever instead of
 * saying the cloud is unavailable.
 */
export function abandonCloud(): void {
  abandoned = true;
  const err = new Error('(auth/no-user) אין חשבון מחובר');
  while (waiting.length) waiting.pop()!.reject(err);
}

/** Re-read the user after an operation that changes it without a state change. */
function refresh(): User | null {
  const { auth } = ensureApp();
  user = auth.currentUser;
  ready = true;
  notify();
  return user;
}

// ------------------------------------------------------------- sign-in ops

/**
 * Popup rather than redirect, on phones too.
 *
 * The redirect flow needs the auth domain's cookies to survive a round trip
 * through Google, which is exactly what browsers with partitioned third-party
 * storage no longer allow — it fails silently there, which is the worst way to
 * fail. A popup is blockable, but a blocked popup says so, and email and
 * password is always there as the way through.
 */
function googleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  // Always ask which account, so a shared computer does not silently reuse one.
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

export async function signInAnonymous(): Promise<User> {
  const { auth } = ensureApp();
  return (await signInAnonymously(auth)).user;
}

export async function signInGoogle(): Promise<User> {
  const { auth } = ensureApp();
  return (await signInWithPopup(auth, googleProvider())).user;
}

export async function signInPassword(email: string, password: string): Promise<User> {
  const { auth } = ensureApp();
  return (await signInWithEmailAndPassword(auth, email, password)).user;
}

export async function signUpPassword(email: string, password: string): Promise<User> {
  const { auth } = ensureApp();
  return (await createUserWithEmailAndPassword(auth, email, password)).user;
}

export async function sendReset(email: string): Promise<void> {
  const { auth } = ensureApp();
  await sendPasswordResetEmail(auth, email);
}

export async function signOutUser(): Promise<void> {
  const { auth } = ensureApp();
  await signOut(auth);
  user = null;
  notify();
}

// ---------------------------------------------------------------- linking

/**
 * Give an anonymous identity a way back in.
 *
 * Linking keeps the same uid, which is the whole point: every model, every
 * entry and every point stays exactly where it is, and the account simply gains
 * a second door. Nothing is copied and nothing is migrated.
 *
 * The one case that cannot work this way is a Google account or an email that
 * already belongs to another identity here — two accounts cannot merge, because
 * there is no server to merge them. `auth/credential-already-in-use` and
 * `auth/email-already-in-use` are how that surfaces, and the caller offers
 * signing in to that account instead.
 */
export async function linkGoogle(): Promise<User> {
  const { auth } = ensureApp();
  if (!auth.currentUser) throw new Error('(auth/no-user) אין חשבון מחובר');
  const cred = await linkWithPopup(auth.currentUser, googleProvider());
  refresh();
  return cred.user;
}

export async function linkPassword(email: string, password: string): Promise<User> {
  const { auth } = ensureApp();
  if (!auth.currentUser) throw new Error('(auth/no-user) אין חשבון מחובר');
  const cred = await linkWithCredential(auth.currentUser, EmailAuthProvider.credential(email, password));
  refresh();
  return cred.user;
}
