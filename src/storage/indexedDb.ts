import type { ModelMeta, ModelRecord, ModelStore } from './types';
import { stripWeights } from './types';

const DB_NAME = 'rl-arena';
const DB_VERSION = 1;
const META_STORE = 'meta';
const WEIGHTS_STORE = 'weights';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        const s = db.createObjectStore(META_STORE, { keyPath: 'id' });
        s.createIndex('gameId', 'gameId', { unique: false });
      }
      if (!db.objectStoreNames.contains(WEIGHTS_STORE)) {
        db.createObjectStore(WEIGHTS_STORE);
      }
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
 * Always-available local store. Metadata and weights live in separate object
 * stores so listing the library never has to read megabytes of weights.
 */
export class LocalStore implements ModelStore {
  readonly kind = 'local' as const;
  readonly label = 'הדפדפן הזה (IndexedDB)';

  private dbPromise: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) this.dbPromise = openDb();
    return this.dbPromise;
  }

  async list(gameId?: string): Promise<ModelMeta[]> {
    const db = await this.db();
    const tx = db.transaction(META_STORE, 'readonly');
    const all = await promisify(tx.objectStore(META_STORE).getAll() as IDBRequest<ModelMeta[]>);
    return all
      .filter((m) => !gameId || m.gameId === gameId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async load(id: string): Promise<ModelRecord | null> {
    const db = await this.db();
    const tx = db.transaction([META_STORE, WEIGHTS_STORE], 'readonly');
    const meta = await promisify(tx.objectStore(META_STORE).get(id) as IDBRequest<ModelMeta | undefined>);
    if (!meta) return null;
    const weightsB64 = await promisify(tx.objectStore(WEIGHTS_STORE).get(id) as IDBRequest<string | undefined>);
    if (!weightsB64) return null;
    return { ...meta, weightsB64 };
  }

  async save(rec: ModelRecord): Promise<void> {
    const db = await this.db();
    const tx = db.transaction([META_STORE, WEIGHTS_STORE], 'readwrite');
    tx.objectStore(META_STORE).put(stripWeights(rec));
    tx.objectStore(WEIGHTS_STORE).put(rec.weightsB64, rec.id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async remove(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction([META_STORE, WEIGHTS_STORE], 'readwrite');
    tx.objectStore(META_STORE).delete(id);
    tx.objectStore(WEIGHTS_STORE).delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
