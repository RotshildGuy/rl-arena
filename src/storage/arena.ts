import type { ArenaEntry, RaceCard, RaceResult } from '../core/champ/types';
import { SEASON_ID } from '../core/champ/schedule';
import { firebaseConfigured } from './firebase';
import { setCloudError, setCloudOk } from './cloudStatus';

/**
 * The shared side of the game.
 *
 * Private models live in `ModelStore`; this is the public championship: who is
 * entered, what the race cards are, and what happened. Everything here is
 * readable by everyone and writable only by whoever owns it, which is what makes
 * a championship between different people possible at all.
 */
export interface ArenaStore {
  readonly kind: 'local' | 'cloud';
  /** The identity entries are written under. */
  uid(): Promise<string>;
  listEntries(): Promise<ArenaEntry[]>;
  /** `null` weights update only the entry's metadata and leave the car as it is. */
  putEntry(entry: ArenaEntry, weightsB64: string | null): Promise<void>;
  removeEntry(id: string): Promise<void>;
  loadEntryWeights(id: string): Promise<string | null>;

  getCard(raceId: string): Promise<RaceCard | null>;
  /** Create-only: a card that already exists is left exactly as it was. */
  putCard(card: RaceCard, cars: Map<string, string>): Promise<RaceCard>;
  loadRaceWeights(raceId: string): Promise<Map<string, string>>;

  getResult(raceId: string): Promise<RaceResult | null>;
  /** Create-only, for the same reason: the first result computed is the result. */
  putResult(result: RaceResult): Promise<RaceResult>;
}

// --------------------------------------------------------------------- local

const DB_NAME = 'rl-arena-champ';
const DB_VERSION = 1;
const STORE = 'kv';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Single-player championship.
 *
 * Without Firebase there is nobody else to race, so the arena is just this
 * browser's own models running against each other. It keeps every screen
 * working offline and makes the whole thing developable without a project.
 */
class LocalArena implements ArenaStore {
  readonly kind = 'local' as const;
  private dbPromise: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) this.dbPromise = openDb();
    return this.dbPromise;
  }

  private async get<T>(key: string): Promise<T | null> {
    const db = await this.db();
    const tx = db.transaction(STORE, 'readonly');
    const v = await promisify(tx.objectStore(STORE).get(key) as IDBRequest<T | undefined>);
    return v ?? null;
  }

  private async put(key: string, value: unknown): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private async del(key: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private async keys(prefix: string): Promise<string[]> {
    const db = await this.db();
    const tx = db.transaction(STORE, 'readonly');
    const all = await promisify(tx.objectStore(STORE).getAllKeys() as IDBRequest<IDBValidKey[]>);
    return all.map(String).filter((k) => k.startsWith(prefix));
  }

  async uid(): Promise<string> {
    return 'local';
  }

  async listEntries(): Promise<ArenaEntry[]> {
    const keys = await this.keys('entry:');
    const out: ArenaEntry[] = [];
    for (const k of keys) {
      const e = await this.get<ArenaEntry>(k);
      if (e) out.push(e);
    }
    return out;
  }

  async putEntry(entry: ArenaEntry, weightsB64: string | null): Promise<void> {
    await this.put(`entry:${entry.id}`, entry);
    if (weightsB64 !== null) await this.put(`weights:${entry.id}`, weightsB64);
  }

  async removeEntry(id: string): Promise<void> {
    await this.del(`entry:${id}`);
    await this.del(`weights:${id}`);
  }

  loadEntryWeights(id: string): Promise<string | null> {
    return this.get<string>(`weights:${id}`);
  }

  getCard(raceId: string): Promise<RaceCard | null> {
    return this.get<RaceCard>(`card:${raceId}`);
  }

  async putCard(card: RaceCard, cars: Map<string, string>): Promise<RaceCard> {
    const existing = await this.getCard(card.id);
    if (existing) return existing;
    await this.put(`card:${card.id}`, card);
    for (const [entryId, w] of cars) await this.put(`car:${card.id}:${entryId}`, w);
    return card;
  }

  async loadRaceWeights(raceId: string): Promise<Map<string, string>> {
    const keys = await this.keys(`car:${raceId}:`);
    const out = new Map<string, string>();
    for (const k of keys) {
      const w = await this.get<string>(k);
      if (w) out.set(k.slice(`car:${raceId}:`.length), w);
    }
    return out;
  }

  getResult(raceId: string): Promise<RaceResult | null> {
    return this.get<RaceResult>(`result:${raceId}`);
  }

  async putResult(result: RaceResult): Promise<RaceResult> {
    const existing = await this.getResult(result.raceId);
    if (existing) return existing;
    await this.put(`result:${result.raceId}`, result);
    return result;
  }
}

// --------------------------------------------------------------------- cloud

/**
 * Firestore layout:
 *
 *   arena/{entryId}                      the driver — meta only, so the entry
 *   arena/{entryId}/data/weights         list stays a few KB instead of a MB
 *   seasons/{s}/races/{raceId}           the race card
 *   seasons/{s}/races/{raceId}/cars/{e}  weights frozen for that race
 *   seasons/{s}/races/{raceId}/result/final
 *
 * Cards and results are written create-only. Two people opening the app at the
 * same moment both simulate the race; whichever write lands first is the record,
 * and the other reads it back. There is no server to arbitrate, so the rule is
 * simply that history cannot be rewritten.
 */
class FirestoreArena implements ArenaStore {
  readonly kind = 'cloud' as const;

  private async fs() {
    const [{ collection, doc, getDoc, getDocs, setDoc, deleteDoc, writeBatch }, { ensureApp, currentUser }] =
      await Promise.all([import('firebase/firestore'), import('./firebaseApp')]);
    const user = await currentUser();
    const { db } = ensureApp();
    return { collection, doc, getDoc, getDocs, setDoc, deleteDoc, writeBatch, db, uid: user.uid };
  }

  async uid(): Promise<string> {
    return (await this.fs()).uid;
  }

  async listEntries(): Promise<ArenaEntry[]> {
    const { getDocs, collection, db } = await this.fs();
    const snap = await getDocs(collection(db, 'arena'));
    setCloudOk();
    const out: ArenaEntry[] = [];
    snap.forEach((d) => out.push(d.data() as ArenaEntry));
    return out;
  }

  async putEntry(entry: ArenaEntry, weightsB64: string | null): Promise<void> {
    const { doc, setDoc, db } = await this.fs();
    await setDoc(doc(db, 'arena', entry.id), entry);
    if (weightsB64 !== null) await setDoc(doc(db, 'arena', entry.id, 'data', 'weights'), { weightsB64 });
    setCloudOk();
  }

  async removeEntry(id: string): Promise<void> {
    const { doc, deleteDoc, db } = await this.fs();
    await deleteDoc(doc(db, 'arena', id, 'data', 'weights'));
    await deleteDoc(doc(db, 'arena', id));
    setCloudOk();
  }

  async loadEntryWeights(id: string): Promise<string | null> {
    const { doc, getDoc, db } = await this.fs();
    const snap = await getDoc(doc(db, 'arena', id, 'data', 'weights'));
    return snap.exists() ? ((snap.data() as { weightsB64: string }).weightsB64 ?? null) : null;
  }

  async getCard(raceId: string): Promise<RaceCard | null> {
    const { doc, getDoc, db } = await this.fs();
    const snap = await getDoc(doc(db, 'seasons', SEASON_ID, 'races', raceId));
    return snap.exists() ? (snap.data() as RaceCard) : null;
  }

  /**
   * Create-only, and a loser of the race to create is not an error.
   *
   * Two people opening the app at the same moment both simulate the same day and
   * both try to write it. The rules reject the second write; the right answer is
   * to read back what landed, not to report a failure for a card that exists.
   */
  async putCard(card: RaceCard, cars: Map<string, string>): Promise<RaceCard> {
    const existing = await this.getCard(card.id);
    if (existing) return existing;
    const { doc, setDoc, db, writeBatch } = await this.fs();
    try {
      // Cars first: a card without its weights would be an unraceable record.
      let batch = writeBatch(db);
      let n = 0;
      for (const [entryId, weightsB64] of cars) {
        batch.set(doc(db, 'seasons', SEASON_ID, 'races', card.id, 'cars', entryId), { entryId, weightsB64 });
        if (++n % 20 === 0) {
          await batch.commit();
          batch = writeBatch(db);
        }
      }
      if (n % 20 !== 0) await batch.commit();
      await setDoc(doc(db, 'seasons', SEASON_ID, 'races', card.id), card);
      setCloudOk();
      return card;
    } catch (err) {
      const landed = await this.getCard(card.id);
      if (landed) return landed;
      throw err;
    }
  }

  async loadRaceWeights(raceId: string): Promise<Map<string, string>> {
    const { getDocs, collection, db } = await this.fs();
    const snap = await getDocs(collection(db, 'seasons', SEASON_ID, 'races', raceId, 'cars'));
    const out = new Map<string, string>();
    snap.forEach((d) => {
      const data = d.data() as { entryId: string; weightsB64: string };
      out.set(data.entryId, data.weightsB64);
    });
    return out;
  }

  async getResult(raceId: string): Promise<RaceResult | null> {
    const { doc, getDoc, db } = await this.fs();
    const snap = await getDoc(doc(db, 'seasons', SEASON_ID, 'races', raceId, 'result', 'final'));
    return snap.exists() ? (snap.data() as RaceResult) : null;
  }

  async putResult(result: RaceResult): Promise<RaceResult> {
    const existing = await this.getResult(result.raceId);
    if (existing) return existing;
    const { doc, setDoc, db } = await this.fs();
    try {
      await setDoc(doc(db, 'seasons', SEASON_ID, 'races', result.raceId, 'result', 'final'), result);
      setCloudOk();
      return result;
    } catch (err) {
      // Somebody else's identical result got there first.
      const landed = await this.getResult(result.raceId);
      if (landed) return landed;
      throw err;
    }
  }
}

/**
 * Cloud when it is available, this browser when it is not.
 *
 * Unlike the model store there is no mirroring: a local championship and a
 * shared one are different competitions, and silently merging them would invent
 * results nobody raced.
 */
class ArenaFacade implements ArenaStore {
  readonly kind: 'local' | 'cloud';
  constructor(private readonly inner: ArenaStore) {
    this.kind = inner.kind;
  }

  private async guard<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      const v = await fn();
      if (this.inner.kind === 'cloud') setCloudOk();
      return v;
    } catch (err) {
      setCloudError(err);
      return fallback;
    }
  }

  uid() {
    return this.guard(() => this.inner.uid(), 'local');
  }
  listEntries() {
    return this.guard(() => this.inner.listEntries(), [] as ArenaEntry[]);
  }
  putEntry(entry: ArenaEntry, weightsB64: string | null) {
    return this.inner.putEntry(entry, weightsB64);
  }
  removeEntry(id: string) {
    return this.inner.removeEntry(id);
  }
  loadEntryWeights(id: string) {
    return this.guard(() => this.inner.loadEntryWeights(id), null as string | null);
  }
  getCard(raceId: string) {
    return this.guard(() => this.inner.getCard(raceId), null as RaceCard | null);
  }
  putCard(card: RaceCard, cars: Map<string, string>) {
    return this.inner.putCard(card, cars);
  }
  /**
   * Weights frozen for a race never change, so one read per race per session is
   * enough. Without this, flipping between the broadcast and the report re-reads
   * a document per car every time.
   */
  private readonly raceWeights = new Map<string, Promise<Map<string, string>>>();

  loadRaceWeights(raceId: string) {
    let pending = this.raceWeights.get(raceId);
    if (!pending) {
      pending = this.guard(() => this.inner.loadRaceWeights(raceId), new Map<string, string>()).then((w) => {
        // An empty result means the read failed or the cars are not written yet;
        // either way it is worth asking again rather than caching the gap.
        if (w.size === 0) this.raceWeights.delete(raceId);
        return w;
      });
      this.raceWeights.set(raceId, pending);
    }
    return pending;
  }
  getResult(raceId: string) {
    return this.guard(() => this.inner.getResult(raceId), null as RaceResult | null);
  }
  putResult(result: RaceResult) {
    return this.inner.putResult(result);
  }
}

let arenaPromise: Promise<ArenaStore> | null = null;

export function getArena(): Promise<ArenaStore> {
  if (arenaPromise) return arenaPromise;
  arenaPromise = (async () => new ArenaFacade(firebaseConfigured ? new FirestoreArena() : new LocalArena()))();
  return arenaPromise;
}
