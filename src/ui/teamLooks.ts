import { useEffect, useMemo, useState } from 'react';
import { earnedCoins } from '../core/champ/coins';
import { validLook } from '../core/champ/shop';
import { settledResults } from '../core/champ/timing';
import type { CarLook } from '../core/games/racing/render';
import { getShop } from '../storage/shop';
import { useChampionship } from './useChampionship';

export interface TeamPaint {
  color?: string;
  look: CarLook;
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
    const now = Date.now();
    const settled = settledResults(state.cards, state.results, now);
    for (const [uid, doc] of docs) {
      if (!doc) continue;
      const paint = validLook(doc, earnedCoins(uid, state.cards, settled, now).total);
      if (paint) out.set(uid, paint);
    }
    return out;
  }, [docs, state]);
}
