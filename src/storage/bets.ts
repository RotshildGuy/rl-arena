import type { Bet } from '../core/champ/bets';
import { firebaseConfigured } from './firebase';
import { cloudDisabled } from './cloudStatus';

/**
 * A team's bets (`core/champ/bets.ts`) and its public wallet.
 *
 *   users/{uid}/bets/{betId}   the bets: readable and creatable by their owner
 *                              only, never changed or deleted. The server reads
 *                              them to settle.
 *   wallets/{uid}              written by the server alone: `betNet`, the coins
 *                              won minus the coins staked on finished bets. It
 *                              is public so every browser can check a team's
 *                              purchases against everything it earned - the
 *                              net says nothing of what was backed.
 *
 * Without the cloud (the offline mode and the dev server's `?demo`) the bets
 * are kept in this browser and settled here.
 */
const LOCAL_KEY = 'rl-arena-bets';

function online(): boolean {
  return firebaseConfigured && !cloudDisabled();
}

async function fs() {
  const [firestore, { ensureApp }] = await Promise.all([import('firebase/firestore'), import('./firebaseApp')]);
  return { ...firestore, db: ensureApp().db };
}

const listeners = new Set<() => void>();

/** Called after a bet is placed, so every screen that shows coins counts again. */
export function onBetsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function readLocal(): Bet[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as Bet[];
  } catch {
    return [];
  }
}

/** This browser's own bets, without the cloud. */
export function localBets(): Bet[] {
  return online() ? [] : readLocal();
}

export async function listMyBets(uid: string): Promise<Bet[]> {
  if (!uid) return [];
  if (!online()) return readLocal();
  try {
    const { collection, getDocs, db } = await fs();
    const snap = await getDocs(collection(db, 'users', uid, 'bets'));
    return snap.docs.map((d) => d.data() as Bet);
  } catch {
    return [];
  }
}

export async function placeBet(uid: string, bet: Bet): Promise<void> {
  if (!online()) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify([...readLocal(), bet]));
  } else {
    const { doc, setDoc, db } = await fs();
    await setDoc(doc(db, 'users', uid, 'bets', bet.id), bet);
  }
  for (const fn of listeners) fn();
}

const walletCache = new Map<string, Promise<number>>();

/**
 * What the server says a team has won or lost on finished bets: 0 when it has
 * said nothing, null without the cloud - there the browser settles its own.
 */
export function publishedBetNet(uid: string): Promise<number | null> {
  if (!online()) return Promise.resolve(null);
  if (!uid) return Promise.resolve(0);
  let p = walletCache.get(uid);
  if (!p) {
    p = fs()
      .then(({ doc, getDoc, db }) => getDoc(doc(db, 'wallets', uid)))
      .then((snap) => {
        const v = snap.exists() ? (snap.data() as { betNet?: unknown }).betNet : 0;
        return typeof v === 'number' && Number.isFinite(v) ? v : 0;
      })
      .catch(() => 0);
    walletCache.set(uid, p);
  }
  return p;
}
