import { firebaseConfigured } from './firebase';
import { cloudDisabled } from './cloudStatus';

/**
 * The one thing about a person that is not a model and not a car: their name.
 *
 * It used to live only in this browser's localStorage, which was right when an
 * identity *was* a browser — anonymous auth hands out an id and nothing else.
 * Now that an account can be signed in to from anywhere, a team name that stays
 * behind is a trap: the second device asks for it again, a slightly different
 * spelling is a different constructor, and the points quietly split across two
 * rows of the teams' table.
 *
 * Stored under the private library rather than beside the public entries, in a
 * subcollection of `users/{uid}` so the same rule that locks the library to its
 * owner covers it:
 *
 *   users/{uid}/profile/main
 *
 * localStorage stays as the synchronous copy — every screen reads the name
 * while it renders, and waiting on the network for that would mean a header
 * that pops in — and it is the whole story for anyone who never signs in.
 */
export interface Profile {
  competitor: string;
  updatedAt: number;
}

async function ref() {
  const [{ doc }, { ensureApp, currentUser }] = await Promise.all([
    import('firebase/firestore'),
    import('./firebaseApp'),
  ]);
  const user = await currentUser();
  return { doc: doc(ensureApp().db, 'users', user.uid, 'profile', 'main') };
}

/** Whether there is an account to keep a profile in at all. */
function available(): boolean {
  return firebaseConfigured && !cloudDisabled();
}

export async function loadProfile(): Promise<Profile | null> {
  if (!available()) return null;
  const [{ getDoc }, { doc }] = await Promise.all([import('firebase/firestore'), ref()]);
  const snap = await getDoc(doc);
  return snap.exists() ? (snap.data() as Profile) : null;
}

export async function saveProfile(competitor: string): Promise<void> {
  if (!available()) return;
  const [{ setDoc }, { doc }] = await Promise.all([import('firebase/firestore'), ref()]);
  await setDoc(doc, { competitor, updatedAt: Date.now() } satisfies Profile);
}

/**
 * Part of erasing everything. Without it the name would come back from the
 * cloud on the next load, which is the one thing a delete button must not do.
 */
export async function deleteProfile(): Promise<void> {
  if (!available()) return;
  const [{ deleteDoc }, { doc }] = await Promise.all([import('firebase/firestore'), ref()]);
  await deleteDoc(doc);
}
