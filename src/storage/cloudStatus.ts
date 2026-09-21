import { firebaseConfigured } from './firebase';

export type CloudState = 'local' | 'connecting' | 'ok' | 'error';

export interface CloudStatus {
  state: CloudState;
  /** Hebrew explanation, ready to show, when state is 'error'. */
  message: string | null;
}

let current: CloudStatus = {
  state: firebaseConfigured ? 'connecting' : 'local',
  message: null,
};

const listeners = new Set<() => void>();

/**
 * Set when the app is asked to carry on without the cloud.
 *
 * The one thing that can reach this state is a project whose authentication is
 * broken — a provider switched off, an unauthorised domain, no network on a
 * first visit — where nobody can sign in and there is nothing to sign in to.
 * From here on the stores behave exactly as they do with no Firebase keys at
 * all, which is a mode the whole app already supports, so the badge says
 * "local" rather than reporting an error over and over.
 */
let disabled = false;

export function disableCloud(): void {
  if (disabled) return;
  disabled = true;
  current = { state: 'local', message: null };
  listeners.forEach((fn) => fn());
}

/** Whether this session has given up on the cloud. Read when a store is built. */
export function cloudDisabled(): boolean {
  return disabled;
}

export function getCloudStatus(): CloudStatus {
  return current;
}

export function subscribeCloudStatus(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setCloudOk(): void {
  if (disabled || current.state === 'ok') return;
  current = { state: 'ok', message: null };
  listeners.forEach((fn) => fn());
}

export function setCloudError(err: unknown): void {
  if (disabled) return;
  const message = explain(err);
  if (current.state === 'error' && current.message === message) return;
  current = { state: 'error', message };
  listeners.forEach((fn) => fn());
}

/**
 * Firebase reports setup problems as opaque codes. Nearly every failure here is
 * one of a handful of console settings, so name the actual fix instead of
 * echoing the code.
 */
function explain(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const code = /\(([\w-]+\/[\w-]+)\)/.exec(raw)?.[1] ?? raw;

  if (/configuration-not-found/i.test(code)) {
    return 'Authentication לא הופעל בפרויקט. פתח את Firebase Console ← Authentication ← Get started.';
  }
  if (/admin-restricted-operation|operation-not-allowed/i.test(code)) {
    return 'שיטת ההתחברות הזאת כבויה בפרויקט. Firebase Console ← Authentication ← Sign-in method.';
  }
  if (/no-user/i.test(code)) {
    return 'אין חשבון מחובר — המודלים נשמרים בדפדפן הזה בלבד.';
  }
  if (/unauthorized-domain/i.test(code)) {
    return 'הדומיין הזה לא מורשה. Firebase Console ← Authentication ← Settings ← Authorized domains.';
  }
  if (/permission-denied/i.test(code)) {
    return 'כללי האבטחה של Firestore חוסמים את הגישה. פרוס את firestore.rules שבריפו.';
  }
  if (/not-found|failed-precondition/i.test(code)) {
    return 'מסד הנתונים של Firestore עוד לא נוצר. Firebase Console ← Firestore Database ← Create database.';
  }
  if (/network|unavailable|offline/i.test(code)) {
    return 'אין חיבור ל-Firestore כרגע.';
  }
  return raw;
}
