/**
 * Config detection only — deliberately free of any Firebase import.
 *
 * The SDK is ~500 KB, and most runs never configure cloud sync, so it lives
 * behind the dynamic import in `firestore.ts` and never reaches the main bundle
 * unless the keys are actually present.
 */
const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
};

/** Cloud sync is opt-in: without keys in .env.local the app runs fully offline. */
export const firebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
);
