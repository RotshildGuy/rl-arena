import type { ModelMeta, ModelRecord, ModelStore } from './types';
import { LocalStore } from './indexedDb';
import { firebaseConfigured } from './firebase';
import { setCloudError, setCloudOk } from './cloudStatus';

export * from './types';
export { LocalStore } from './indexedDb';
export { firebaseConfigured } from './firebase';
export * from './cloudStatus';

/**
 * How long a cloud call may take before the local copy is treated as the answer.
 *
 * Offline, Firestore neither fails nor completes a write: it queues it and the
 * promise simply never settles. Without a deadline the app would sit on
 * "saving..." forever for a model that is already safely in IndexedDB, and the
 * queued write still reaches the server when the connection comes back.
 */
const CLOUD_DEADLINE_MS = 6000;

function withDeadline<T>(work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('cloud timeout')), CLOUD_DEADLINE_MS),
    ),
  ]);
}

/**
 * Cloud-backed store with a local mirror.
 *
 * Writes go to both, reads prefer the cloud but fall back to IndexedDB, so a
 * flaky connection degrades to offline instead of losing a training session.
 */
class SyncedStore implements ModelStore {
  readonly kind = 'cloud' as const;
  readonly label = 'ענן (Firestore) + גיבוי מקומי';

  /** Ids already pushed this session, so one library visit does not re-upload. */
  private readonly backfilled = new Set<string>();

  constructor(
    private readonly cloud: ModelStore,
    private readonly local: ModelStore,
  ) {}

  async list(gameId?: string): Promise<ModelMeta[]> {
    const local = await this.local.list(gameId);
    try {
      const remote = await withDeadline(this.cloud.list(gameId));
      setCloudOk();
      const byId = new Map(remote.map((m) => [m.id, m]));
      const missing: ModelMeta[] = [];
      // Anything saved while offline is still only local.
      for (const m of local) {
        const existing = byId.get(m.id);
        if (!existing) missing.push(m);
        if (!existing || existing.updatedAt < m.updatedAt) byId.set(m.id, m);
      }
      void this.backfill(missing);
      return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (err) {
      setCloudError(err);
      return local;
    }
  }

  /**
   * Push models the cloud has never seen.
   *
   * Without this, everything trained before cloud sync was switched on stays
   * local forever — `save` only ever writes the model being saved, so an old
   * model would need to be re-trained to reach another device. Runs detached so
   * opening the library stays instant.
   */
  private async backfill(missing: ModelMeta[]): Promise<void> {
    for (const meta of missing) {
      if (this.backfilled.has(meta.id)) continue;
      this.backfilled.add(meta.id);
      try {
        const full = await this.local.load(meta.id);
        if (full) await withDeadline(this.cloud.save(full));
      } catch {
        // Leave it for the next visit; the local copy is untouched.
        this.backfilled.delete(meta.id);
        return;
      }
    }
  }

  async load(id: string): Promise<ModelRecord | null> {
    try {
      const remote = await withDeadline(this.cloud.load(id));
      setCloudOk();
      if (remote) return remote;
    } catch (err) {
      setCloudError(err);
    }
    return this.local.load(id);
  }

  /**
   * Local first, and a cloud failure never fails the save — the model is already
   * safely on disk, and reporting "save failed" for a model that is saved is
   * worse than silently falling back to offline.
   */
  async save(rec: ModelRecord): Promise<void> {
    await this.local.save(rec);
    try {
      await withDeadline(this.cloud.save(rec));
      setCloudOk();
    } catch (err) {
      setCloudError(err);
    }
  }

  async remove(id: string): Promise<void> {
    await this.local.remove(id);
    try {
      await withDeadline(this.cloud.remove(id));
      setCloudOk();
    } catch (err) {
      setCloudError(err);
    }
  }
}

let storePromise: Promise<ModelStore> | null = null;

/** Resolves to the cloud-backed store when Firebase is configured, else local-only. */
export function getStore(): Promise<ModelStore> {
  if (storePromise) return storePromise;
  storePromise = (async () => {
    const local = new LocalStore();
    if (!firebaseConfigured) return local;
    // Imported lazily so the Firebase SDK is only fetched when it is actually used.
    const { FirestoreStore } = await import('./firestore');
    return new SyncedStore(new FirestoreStore(), local);
  })();
  return storePromise;
}
