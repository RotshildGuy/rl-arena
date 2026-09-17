import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import type { ModelMeta, ModelRecord, ModelStore } from './types';
import { stripWeights } from './types';
import { currentUser, ensureApp } from './firebaseApp';

/**
 * One document per model under `users/{uid}/models/{id}`.
 *
 * A 24-64-64-9 network is ~6.3k parameters — about 34 KB of base64 — so a whole
 * model including its training history sits far under the 1 MiB document cap.
 */
export class FirestoreStore implements ModelStore {
  readonly kind = 'cloud' as const;
  readonly label = 'ענן (Firestore)';

  private async col() {
    const user = await currentUser();
    return collection(ensureApp().db, 'users', user.uid, 'models');
  }

  private async docRef(id: string) {
    const user = await currentUser();
    return doc(ensureApp().db, 'users', user.uid, 'models', id);
  }

  async list(gameId?: string): Promise<ModelMeta[]> {
    const snap = await getDocs(await this.col());
    const out: ModelMeta[] = [];
    snap.forEach((d) => {
      const data = d.data() as ModelRecord;
      if (!gameId || data.gameId === gameId) out.push(stripWeights(data));
    });
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async load(id: string): Promise<ModelRecord | null> {
    const snap = await getDoc(await this.docRef(id));
    return snap.exists() ? (snap.data() as ModelRecord) : null;
  }

  async save(rec: ModelRecord): Promise<void> {
    await setDoc(await this.docRef(rec.id), rec);
  }

  async remove(id: string): Promise<void> {
    await deleteDoc(await this.docRef(id));
  }
}
