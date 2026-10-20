import { firebaseConfigured } from '../storage/firebase';
import { cloudDisabled } from '../storage/cloudStatus';

/**
 * Race reminders by push: "starts in a quarter of an hour" at 19:45, and how
 * your car did once the race is over. The calendar entry needs somebody to act
 * on it; a notification arrives on its own, even with the site closed.
 *
 * The browser half: ask permission, get a Firebase Cloud Messaging token for
 * this device and store it under `pushTokens/{token}` with the account it
 * belongs to. The sending is a scheduled function (`functions/index.js`).
 *
 * Works out of the box on Android and desktop browsers. An iPhone delivers
 * web push only to a site added to the home screen, so there the page shows
 * how to do that first.
 */
const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
const FLAG = 'rl-arena-push';

export type PushState = 'unsupported' | 'needs-install' | 'off' | 'on' | 'blocked';

export function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function pushState(): PushState {
  if (!VAPID_KEY || !firebaseConfigured || cloudDisabled()) return 'unsupported';
  if (isIos() && !isStandalone()) return 'needs-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  try {
    return localStorage.getItem(FLAG) && Notification.permission === 'granted' ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

/** Registered at startup: installability needs it even for people who never turn push on. */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // An installable site is a bonus; a failed registration changes nothing else.
    });
  });
}

async function messagingToken(): Promise<string> {
  const [{ getApp }, { getMessaging, getToken }] = await Promise.all([import('firebase/app'), import('firebase/messaging')]);
  const { ensureApp } = await import('../storage/firebaseApp');
  ensureApp();
  const registration = await navigator.serviceWorker.ready;
  return getToken(getMessaging(getApp()), { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
}

export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const token = await messagingToken();
  const [{ doc, setDoc }, { ensureApp, currentUser }] = await Promise.all([
    import('firebase/firestore'),
    import('../storage/firebaseApp'),
  ]);
  const { db } = ensureApp();
  const user = await currentUser();
  await setDoc(doc(db, 'pushTokens', token), { uid: user.uid, token, createdAt: Date.now() });
  try {
    localStorage.setItem(FLAG, token);
  } catch {
    // The token is stored; only the switch's memory of it is lost.
  }
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  let token: string | null = null;
  try {
    token = localStorage.getItem(FLAG);
    localStorage.removeItem(FLAG);
  } catch {
    // Carry on and unsubscribe anyway.
  }
  try {
    const [{ getApp }, { getMessaging, deleteToken }] = await Promise.all([import('firebase/app'), import('firebase/messaging')]);
    await deleteToken(getMessaging(getApp()));
  } catch {
    // Already gone.
  }
  if (token) {
    const [{ doc, deleteDoc }, { ensureApp }] = await Promise.all([import('firebase/firestore'), import('../storage/firebaseApp')]);
    await deleteDoc(doc(ensureApp().db, 'pushTokens', token)).catch(() => {});
  }
  return 'off';
}
