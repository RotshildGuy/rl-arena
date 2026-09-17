import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously, type Auth, type User } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { firebaseConfig, firebaseConfigured } from './firebase';

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let userPromise: Promise<User> | null = null;

/**
 * One Firebase app for the whole session. Both the private model store and the
 * shared championship arena go through here, so they share a single anonymous
 * identity instead of racing each other to create one.
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

/** Anonymous sign-in: an identity to own models with, without a signup flow. */
export function currentUser(): Promise<User> {
  if (userPromise) return userPromise;
  const { auth } = ensureApp();
  userPromise = new Promise<User>((resolve, reject) => {
    const unsub = onAuthStateChanged(
      auth,
      (u) => {
        if (u) {
          unsub();
          resolve(u);
        }
      },
      reject,
    );
    signInAnonymously(auth).catch(reject);
  });
  return userPromise;
}
