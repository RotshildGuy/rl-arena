import { useEffect, useMemo, useState } from 'react';
import { earnedCoins } from '../core/champ/coins';
import { validLook, type Paint } from '../core/champ/shop';
import { settledResults } from '../core/champ/timing';
import type { RaceCard, RaceResult } from '../core/champ/types';
import { getShop } from '../storage/shop';
import { useChampionship } from './useChampionship';

export type TeamPaint = Paint;

/**
 * Coins earned, worked out once per team per championship state: every table
 * row with an emblem asks, and the sum over every race is not free.
 */
const earnedCache = new WeakMap<object, Map<string, number>>();
function earnedFor(uid: string, cards: RaceCard[], results: Map<string, RaceResult>): number {
  let byUid = earnedCache.get(results);
  if (!byUid) {
    byUid = new Map();
    earnedCache.set(results, byUid);
  }
  let total = byUid.get(uid);
  if (total === undefined) {
    const now = Date.now();
    total = earnedCoins(uid, cards, settledResults(cards, results, now), now).total;
    byUid.set(uid, total);
  }
  return total;
}

/**
 * What each team bought for its car, checked: read every team's shop
 * document, and keep only the looks that team can afford from coins this
 * browser works out itself. Anything that does not add up is drawn default.
 */
export function useTeamPaint(uids: string[]): Map<string, TeamPaint> {
  const { state } = useChampionship();
  const [docs, setDocs] = useState<Map<string, Awaited<ReturnType<typeof getShop>>>>(new Map());
  const key = [...new Set(uids)].sort().join(',');

  useEffect(() => {
    let cancelled = false;
    const list = key ? key.split(',') : [];
    void Promise.all(list.map(async (uid) => [uid, await getShop(uid)] as const)).then((pairs) => {
      if (!cancelled) setDocs(new Map(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return useMemo(() => {
    const out = new Map<string, TeamPaint>();
    if (!state) return out;
    for (const [uid, doc] of docs) {
      if (!doc) continue;
      const paint = validLook(doc, earnedFor(uid, state.cards, state.results));
      if (paint) out.set(uid, paint);
    }
    return out;
  }, [docs, state]);
}

/** One team's checked paint, for a table row: its colour and emblem. */
export function useOneTeamPaint(uid: string | undefined): TeamPaint | undefined {
  return useTeamPaint(uid ? [uid] : []).get(uid ?? '');
}
