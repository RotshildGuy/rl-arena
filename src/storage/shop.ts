import { normalizeShop, type ShopDoc } from '../core/champ/shop';
import { giftDay, giftPacks, newGift, packsOpen, type GiftRecord, type PackTypeId } from '../core/champ/packs';
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

/** The sample teams' shop documents, written by the dev server's `?demo` (`src/dev/demo.ts`). */
export const DEMO_SHOP_KEY = 'rl-arena-demo-shop';

export function getShop(uid: string): Promise<ShopDoc | null> {
  if (!online()) {
    try {
      if (import.meta.env.DEV && uid !== 'local') {
        const demo = JSON.parse(localStorage.getItem(DEMO_SHOP_KEY) ?? '{}') as Record<string, ShopDoc>;
        return Promise.resolve(demo[uid] ?? null);
      }
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

const listeners = new Set<() => void>();

/** Called after this team's shop document is written (a gift claimed, a look saved), so screens read it again. */
export function onShopChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function saveShop(uid: string, next: ShopDoc): Promise<void> {
  // A screen opened before today's gift was claimed holds a document without
  // it. The claims only ever grow, and the rules refuse a write that drops
  // one, so the longer list known here wins.
  const known = await (cache.get(uid) ?? Promise.resolve(null)).catch(() => null);
  const gifts = (known?.gifts?.length ?? 0) > (next.gifts?.length ?? 0) ? known!.gifts : next.gifts;
  // Through JSON, so a field cleared to undefined is dropped - Firestore refuses undefined.
  const doc_ = JSON.parse(JSON.stringify({ ...next, gifts, purchases: [...new Set(next.purchases)], updatedAt: Date.now() })) as ShopDoc;
  cache.set(uid, Promise.resolve(doc_));
  if (!online()) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(doc_));
    return;
  }
  const { doc, setDoc, db } = await fs();
  await setDoc(doc(db, 'shop', uid), doc_);
}

/**
 * Today's gift pack (`core/champ/packs.ts`), if packs are on and it is not
 * claimed yet. Returns the claim written, or null. A second tab claiming the
 * same day is refused by the rules and returns null here.
 */
export async function claimDailyGift(uid: string, now = Date.now()): Promise<{ gift: GiftRecord; type: PackTypeId } | null> {
  if (!uid || !packsOpen(now)) return null;
  const doc_ = normalizeShop(await myShop(uid));
  const gifts = doc_.gifts ?? [];
  const today = giftDay(now);
  if (gifts.some((g) => g.day >= today)) return null;
  const gift = newGift(now);
  try {
    await saveShop(uid, { ...doc_, gifts: [...gifts, gift] });
  } catch {
    return null;
  }
  for (const fn of listeners) fn();
  const mine = giftPacks([...gifts, gift]).find((p) => p.gift === gift);
  return mine ? { gift, type: mine.type } : null;
}
