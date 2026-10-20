import type { RaceCard } from './types';

/**
 * Spotting copied cars.
 *
 * Every car's weights have to be readable by everybody, because every browser
 * runs the race itself - so nothing can stop somebody downloading the leader's
 * model and entering it as their own. What can be done is to say so. Each race
 * card records a fingerprint of the weights each car raced with, and a car
 * whose fingerprint matches one another team raced with first is labelled a
 * copy of that car.
 *
 * Only an exact copy is caught. Train a copy for a minute and the fingerprint
 * changes; at that point it is arguably the copier's own model anyway.
 */

/** FNV-1a over the base64 text, 64 bits as hex. Fast, stable, not a security hash. */
export function weightsFingerprint(b64: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < b64.length; i++) {
    const c = b64.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export interface CopyOf {
  driver: string;
  team: string;
  round: number;
}

/**
 * For every card and car, the earlier car of *another* team it is an exact copy
 * of. Keyed `${cardId}/${entryId}`. The first team to race a set of weights is
 * the original, whatever happens after.
 */
export function findCopies(cards: RaceCard[]): Map<string, CopyOf> {
  const first = new Map<string, { uid: string } & CopyOf>();
  const out = new Map<string, CopyOf>();
  const ordered = [...cards].sort((a, b) => a.round - b.round);
  for (const card of ordered) {
    const hashes = card.fingerprints;
    if (!hashes) continue;
    // Within a card, the entry that registered first is the original.
    const entries = [...card.entries].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    for (const e of entries) {
      const h = hashes[e.id];
      if (!h) continue;
      const seen = first.get(h);
      if (!seen) {
        first.set(h, { uid: e.uid, driver: e.driver, team: e.team, round: card.round });
      } else if (seen.uid !== e.uid) {
        out.set(`${card.id}/${e.id}`, { driver: seen.driver, team: seen.team, round: seen.round });
      }
    }
  }
  return out;
}
