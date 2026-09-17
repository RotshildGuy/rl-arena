import type { RaceCard, RaceResult } from '../core/champ/types';

/**
 * Local mirror of the championship's history.
 *
 * Race cards and results are written create-only and can never change, which
 * makes them perfectly cacheable: once this browser has seen round 7, it never
 * needs to ask about round 7 again. That matters because the naive version — ask
 * the server for every card and every result on every visit — costs reads in
 * proportion to the length of the season, and a season that runs a year would
 * push a handful of friends past the free quota purely by existing.
 *
 * Rounds that never happened are remembered too, as "blank". A round can only be
 * created inside the backfill window, so once it falls out of that window the
 * absence is permanent and worth recording — otherwise every quiet day in the
 * calendar costs a read, forever.
 */
export interface ChampCache {
  getCard(raceId: string): Promise<RaceCard | null>;
  putCard(card: RaceCard): Promise<void>;
  getResult(raceId: string): Promise<RaceResult | null>;
  putResult(result: RaceResult): Promise<void>;
  isBlank(raceId: string): Promise<boolean>;
  markBlank(raceId: string): Promise<void>;
}

const DB_NAME = 'rl-arena-champ';
const DB_VERSION = 1;
const STORE = 'kv';
/** Prefix keeps this clear of the local-arena records in the same store. */
const P = 'cc:';

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

class IdbCache implements ChampCache {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) this.dbPromise = openDb();
    return this.dbPromise;
  }

  private async get<T>(key: string): Promise<T | null> {
    const db = await this.db();
    const tx = db.transaction(STORE, 'readonly');
    return new Promise<T | null>((resolve, reject) => {
      const req = tx.objectStore(STORE).get(P + key) as IDBRequest<T | undefined>;
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  private async put(key: string, value: unknown): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, P + key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  getCard(raceId: string) {
    return this.get<RaceCard>(`card:${raceId}`);
  }
  putCard(card: RaceCard) {
    return this.put(`card:${card.id}`, card);
  }
  getResult(raceId: string) {
    return this.get<RaceResult>(`result:${raceId}`);
  }
  putResult(result: RaceResult) {
    return this.put(`result:${result.raceId}`, result);
  }
  async isBlank(raceId: string) {
    return (await this.get<boolean>(`blank:${raceId}`)) === true;
  }
  markBlank(raceId: string) {
    return this.put(`blank:${raceId}`, true);
  }
}

/**
 * Never fails a sync. A browser with storage disabled simply reads from the
 * server every time, which is the behaviour this whole file exists to avoid —
 * but it is still better than an app that will not load.
 */
class NullCache implements ChampCache {
  async getCard() {
    return null;
  }
  async putCard() {}
  async getResult() {
    return null;
  }
  async putResult() {}
  async isBlank() {
    return false;
  }
  async markBlank() {}
}

function guarded(inner: ChampCache): ChampCache {
  const safe = <T>(fn: () => Promise<T>, fallback: T): Promise<T> => fn().catch(() => fallback);
  return {
    getCard: (id) => safe(() => inner.getCard(id), null),
    putCard: (c) => safe(() => inner.putCard(c), undefined),
    getResult: (id) => safe(() => inner.getResult(id), null),
    putResult: (r) => safe(() => inner.putResult(r), undefined),
    isBlank: (id) => safe(() => inner.isBlank(id), false),
    markBlank: (id) => safe(() => inner.markBlank(id), undefined),
  };
}

let cache: ChampCache | null = null;

/**
 * Only worth having in front of the cloud. The local arena already reads from
 * IndexedDB, so caching it there would be one database in front of another.
 */
export function getChampCache(kind: 'local' | 'cloud'): ChampCache {
  if (!cache) {
    cache = kind === 'cloud' && typeof indexedDB !== 'undefined' ? guarded(new IdbCache()) : new NullCache();
  }
  return cache;
}
