import type { Feedback, FeedbackKind, FeedbackStatus } from '../core/feedback';
import { firebaseConfigured } from './firebase';
import { cloudDisabled } from './cloudStatus';

/**
 * Where feedback goes: `feedback/{id}` in the same Firestore as everything
 * else. The sender can read their own messages back, with the status and any
 * reply; only operators (`admins()`) can read everybody's and mark them.
 *
 * Without the cloud there is nobody to send to, so a message is kept in this
 * browser and the page offers e-mail instead.
 */
const LOCAL_KEY = 'rl-arena-feedback';

export function feedbackOnline(): boolean {
  return firebaseConfigured && !cloudDisabled();
}

async function fs() {
  const [firestore, { ensureApp, currentUser }] = await Promise.all([import('firebase/firestore'), import('./firebaseApp')]);
  const { db } = ensureApp();
  const user = await currentUser();
  return { ...firestore, db, uid: user.uid };
}

export interface NewFeedback {
  kind: FeedbackKind;
  text: string;
  screen: string;
  device?: string;
  contact?: string;
}

export async function sendFeedback(input: NewFeedback): Promise<Feedback> {
  const base = {
    kind: input.kind,
    text: input.text.trim(),
    screen: input.screen,
    createdAt: Date.now(),
    status: 'new' as FeedbackStatus,
    ...(input.device ? { device: input.device } : {}),
    ...(input.contact?.trim() ? { contact: input.contact.trim() } : {}),
  };
  if (!feedbackOnline()) {
    const item: Feedback = { id: `local-${base.createdAt}`, uid: 'local', ...base };
    const all = readLocal();
    all.unshift(item);
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(all.slice(0, 50)));
    } catch {
      // Nothing to keep it in; the page still offers e-mail.
    }
    return item;
  }
  const { collection, doc, setDoc, db, uid } = await fs();
  const ref = doc(collection(db, 'feedback'));
  const item: Feedback = { id: ref.id, uid, ...base };
  const { id: _id, ...data } = item;
  await setDoc(ref, data);
  return item;
}

function readLocal(): Feedback[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as Feedback[];
  } catch {
    return [];
  }
}

/** This account's own messages, newest first. */
export async function myFeedback(): Promise<Feedback[]> {
  if (!feedbackOnline()) return readLocal();
  const { collection, getDocs, query, where, db, uid } = await fs();
  const snap = await getDocs(query(collection(db, 'feedback'), where('uid', '==', uid)));
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Feedback, 'id'>) }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Everybody's, for operators. Rejects for anybody else, and the page then shows nothing. */
export async function allFeedback(): Promise<Feedback[]> {
  if (!feedbackOnline()) throw new Error('no cloud');
  const { collection, getDocs, limit, orderBy, query, db } = await fs();
  const snap = await getDocs(query(collection(db, 'feedback'), orderBy('createdAt', 'desc'), limit(200)));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Feedback, 'id'>) }));
}

export async function markFeedback(id: string, status: FeedbackStatus, reply?: string): Promise<void> {
  const { doc, updateDoc, db } = await fs();
  await updateDoc(doc(db, 'feedback', id), { status, ...(reply !== undefined ? { reply } : {}) });
}
