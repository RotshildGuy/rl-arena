import { dayKey, type MetricEvent, type MetricRow } from '../core/metrics';
import { firebaseConfigured } from './firebase';
import { cloudDisabled } from './cloudStatus';

/**
 * Anonymous usage counts, written to `metrics/{day}/events/{uid}_{event}`.
 *
 * One document per account, per event, per day - the id is the whole record,
 * so doing the same thing twice in a day writes nothing new and the collection
 * can never say more than "this account did this, that day". No third party
 * sees any of it: it sits in the same Firestore as the championship.
 *
 * Everything here is best effort. A rule that has not been published yet, a
 * network blip, an offline run without cloud keys - all of them mean an event
 * goes uncounted, and none of them may ever reach the person playing.
 */
const sent = new Set<string>();

export function track(event: MetricEvent): void {
  if (!firebaseConfigured || cloudDisabled()) return;
  const day = dayKey(Date.now());
  const key = `${day}:${event}`;
  if (sent.has(key)) return;
  sent.add(key);
  void (async () => {
    const [{ doc, setDoc }, { ensureApp, currentUser }] = await Promise.all([
      import('firebase/firestore'),
      import('./firebaseApp'),
    ]);
    const { db } = ensureApp();
    const user = await currentUser();
    const row: MetricRow = { uid: user.uid, event, day };
    await setDoc(doc(db, 'metrics', day, 'events', `${user.uid}_${event}`), row);
  })().catch(() => {
    // Let a later attempt today try again - the failure may have been the network.
    sent.delete(key);
  });
}

/**
 * The last `days` days of events. Only operators can read them (`admins()` in
 * `firestore.rules`); for anybody else this rejects and the caller shows nothing.
 */
export async function loadMetrics(days: number, now = Date.now()): Promise<MetricRow[]> {
  if (!firebaseConfigured || cloudDisabled()) throw new Error('no cloud');
  const [{ collection, getDocs }, { ensureApp }] = await Promise.all([
    import('firebase/firestore'),
    import('./firebaseApp'),
  ]);
  const { db } = ensureApp();
  const keys: string[] = [];
  for (let i = 0; i < days; i++) keys.push(dayKey(now - i * 24 * 60 * 60 * 1000));
  const snaps = await Promise.all(keys.map((d) => getDocs(collection(db, 'metrics', d, 'events'))));
  return snaps.flatMap((s) => s.docs.map((d) => d.data() as MetricRow));
}
