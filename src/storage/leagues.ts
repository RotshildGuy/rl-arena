import { LEAGUE_NAME_MAX, newLeagueId, type League } from '../core/champ/league';
import { firebaseConfigured } from './firebase';
import { cloudDisabled } from './cloudStatus';
import { t } from '../i18n';

/**
 * Friends' leagues, in Firestore. Only names and account ids: the races and
 * results are the championship's own, filtered on the reader's side.
 */
export function leaguesAvailable(): boolean {
  return firebaseConfigured && !cloudDisabled();
}

async function fs() {
  const [firestore, { ensureApp, currentUser }] = await Promise.all([import('firebase/firestore'), import('./firebaseApp')]);
  const { db } = ensureApp();
  const user = await currentUser();
  return { ...firestore, db, uid: user.uid };
}

export async function myLeagues(): Promise<League[]> {
  const { collection, getDocs, query, where, db, uid } = await fs();
  const snap = await getDocs(query(collection(db, 'leagues'), where('members', 'array-contains', uid)));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<League, 'id'>) })).sort((a, b) => a.createdAt - b.createdAt);
}

export async function getLeague(id: string): Promise<League | null> {
  const { doc, getDoc, db } = await fs();
  const snap = await getDoc(doc(db, 'leagues', id));
  return snap.exists() ? { id: snap.id, ...(snap.data() as Omit<League, 'id'>) } : null;
}

export async function createLeague(name: string): Promise<League> {
  const { doc, setDoc, db, uid } = await fs();
  const league: League = {
    id: newLeagueId(),
    name: name.trim().slice(0, LEAGUE_NAME_MAX),
    owner: uid,
    members: [uid],
    createdAt: Date.now(),
  };
  const { id, ...data } = league;
  await setDoc(doc(db, 'leagues', id), data);
  return league;
}

/** Join by invitation. Joining twice is harmless. */
export async function joinLeague(id: string): Promise<League> {
  const { doc, updateDoc, arrayUnion, db, uid } = await fs();
  await updateDoc(doc(db, 'leagues', id), { members: arrayUnion(uid) });
  const league = await getLeague(id);
  if (!league) throw new Error(t().authErrors.leagueMissing);
  return league;
}

export async function leaveLeague(id: string): Promise<void> {
  const { doc, updateDoc, arrayRemove, db, uid } = await fs();
  await updateDoc(doc(db, 'leagues', id), { members: arrayRemove(uid) });
}

export function inviteLink(id: string): string {
  return `${window.location.origin}/?league=${id}`;
}
