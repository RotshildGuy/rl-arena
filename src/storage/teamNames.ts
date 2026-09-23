import { firebaseConfigured } from './firebase';
import { cloudDisabled } from './cloudStatus';
import { nameKey } from '../core/champ/names';

/**
 * One team name, one account.
 *
 * Every name in use has a document keyed by the name itself, holding the uid
 * that owns it:
 *
 *   names/{key}   { uid, name, updatedAt }
 *
 * Keying by the name is what makes it unique without a server: a document id
 * can only exist once, and the rules let an account create a claim for itself
 * but never take over one that belongs to somebody else. Claiming a name and
 * releasing the old one happen in one transaction, so a rename never leaves
 * the account holding two names or none.
 *
 * The name decides nothing else. The grid, the drivers and the team table all
 * key on the uid; this is only here so that two teams in the tables can never
 * look like one.
 */
export class NameTakenError extends Error {
  constructor() {
    super('השם הזה כבר תפוס על ידי מתחרה אחר. בחרו שם אחר.');
  }
}

function available(): boolean {
  return firebaseConfigured && !cloudDisabled();
}

function isPermissionDenied(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'permission-denied';
}

let warned = false;

/**
 * Take `name` for this account, and let go of `previous` if it was ours.
 *
 * Throws `NameTakenError` when another account holds it. Without a cloud there
 * is nobody to collide with, so it simply succeeds.
 *
 * A project whose rules have not been given the `names` collection yet refuses
 * every read and write there. That is treated as "no registry" rather than as
 * "every name is taken": uniqueness starts the moment the rules are published,
 * and nobody is locked out of naming their team in the meantime.
 */
export async function claimName(name: string, previous?: string): Promise<void> {
  if (!available()) return;
  const [{ doc, runTransaction }, { ensureApp, currentUser }] = await Promise.all([
    import('firebase/firestore'),
    import('./firebaseApp'),
  ]);
  const user = await currentUser();
  const { db } = ensureApp();
  const key = nameKey(name);
  const oldKey = previous ? nameKey(previous) : null;

  try {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, 'names', key);
      const oldRef = oldKey && oldKey !== key ? doc(db, 'names', oldKey) : null;
      // Every read before any write: a transaction insists on it.
      const snap = await tx.get(ref);
      const oldSnap = oldRef ? await tx.get(oldRef) : null;

      const owner = snap.exists() ? (snap.data() as { uid?: string }).uid : undefined;
      if (owner && owner !== user.uid) throw new NameTakenError();

      tx.set(ref, { uid: user.uid, name, updatedAt: Date.now() });
      if (oldRef && oldSnap?.exists() && (oldSnap.data() as { uid?: string }).uid === user.uid) tx.delete(oldRef);
    });
  } catch (err) {
    if (err instanceof NameTakenError) throw err;
    if (isPermissionDenied(err)) {
      if (!warned) {
        warned = true;
        console.warn('[names] the Firestore rules have no `names` collection yet; team names are not unique until they do');
      }
      return;
    }
    throw err;
  }
}

/** Part of erasing everything: the name goes back to being available. */
export async function releaseName(name: string): Promise<void> {
  if (!available() || !name.trim()) return;
  const [{ doc, getDoc, deleteDoc }, { ensureApp, currentUser }] = await Promise.all([
    import('firebase/firestore'),
    import('./firebaseApp'),
  ]);
  const user = await currentUser();
  const ref = doc(ensureApp().db, 'names', nameKey(name));
  try {
    const snap = await getDoc(ref);
    if (snap.exists() && (snap.data() as { uid?: string }).uid === user.uid) await deleteDoc(ref);
  } catch {
    // Best effort: a name left claimed is a smaller problem than a failed erase.
  }
}
