import type { ShopDoc } from '../core/champ/shop';
import { firebaseConfigured } from './firebase';
import { cloudDisabled } from './cloudStatus';

/**
 * `shop/{uid}`: a team's purchases and what its car wears. Public to read,
 * because everybody's browser paints everybody's car; writable only by its
 * owner. Nothing in it is trusted - see `validLook`.
 */
const LOCAL_KEY = 'rl-arena-shop';
const EMPTY: ShopDoc = { purchases: [], equipped: {}, updatedAt: 0 };

function online(): boolean {
  return firebaseConfigured && !cloudDisabled();
}

async function fs() {
  const [firestore, { ensureApp }] = await Promise.all([import('firebase/firestore'), import('./firebaseApp')]);
  return { ...firestore, db: ensureApp().db };
}

const cache = new Map<string, Promise<ShopDoc | null>>();

export function getShop(uid: string): Promise<ShopDoc | null> {
  if (!online()) {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      return Promise.resolve(uid === 'local' && raw ? (JSON.parse(raw) as ShopDoc) : null);
    } catch {
      return Promise.resolve(null);
    }
  }
  let p = cache.get(uid);
  if (!p) {
    p = fs()
      .then(({ doc, getDoc, db }) => getDoc(doc(db, 'shop', uid)))
      .then((snap) => (snap.exists() ? (snap.data() as ShopDoc) : null))
      .catch(() => null);
    cache.set(uid, p);
  }
  return p;
}

export async function myShop(uid: string): Promise<ShopDoc> {
  cache.delete(uid);
  return (await getShop(uid)) ?? { ...EMPTY };
}

export async function saveShop(uid: string, next: ShopDoc): Promise<void> {
  // Through JSON, so a field cleared to undefined is dropped - Firestore refuses undefined.
  const doc_ = JSON.parse(JSON.stringify({ ...next, purchases: [...new Set(next.purchases)], updatedAt: Date.now() })) as ShopDoc;
  cache.set(uid, Promise.resolve(doc_));
  if (!online()) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(doc_));
    return;
  }
  const { doc, setDoc, db } = await fs();
  await setDoc(doc(db, 'shop', uid), doc_);
}
