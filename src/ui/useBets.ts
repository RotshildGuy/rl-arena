import { useEffect, useMemo, useState } from 'react';
import { betBook, type Bet, type BetBook } from '../core/champ/bets';
import { earnedCoins } from '../core/champ/coins';
import { normalizeShop, spentAll, type ShopDoc } from '../core/champ/shop';
import { settledResults } from '../core/champ/timing';
import { listMyBets, onBetsChanged } from '../storage/bets';
import { myShop } from '../storage/shop';
import { useChampionship } from './useChampionship';

export interface MyBets {
  bets: Bet[];
  book: BetBook;
  /** Coins earned from racing. */
  earned: number;
  /** Earned minus spent in the shop: what the bets are checked against. */
  budget: number;
  /** What there is to spend or bet right now. */
  balance: number;
}

/**
 * This team's bets and its coins with them. `shopDoc`, when the caller holds
 * the team's shop document already (the shop, while buying), is used instead
 * of reading it again.
 */
export function useMyBets(shopDoc?: ShopDoc | null): MyBets | null {
  const { state } = useChampionship();
  const uid = state?.uid ?? '';
  const [bets, setBets] = useState<Bet[] | null>(null);
  const [shop, setShop] = useState<ShopDoc | null>(null);
  const [tick, setTick] = useState(0);
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60_000));

  useEffect(() => onBetsChanged(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    const id = setInterval(() => setMinute(Math.floor(Date.now() / 60_000)), 20_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    void listMyBets(uid).then((b) => !cancelled && setBets(b));
    if (shopDoc === undefined) void myShop(uid).then((d) => !cancelled && setShop(normalizeShop(d)));
    return () => {
      cancelled = true;
    };
  }, [uid, tick, shopDoc]);

  const doc = shopDoc === undefined ? shop : shopDoc;
  return useMemo(() => {
    if (!state || !bets || !doc) return null;
    const now = Date.now();
    const settled = settledResults(state.cards, state.results, now);
    const earned = earnedCoins(uid, state.cards, settled, now).total;
    const budget = earned - spentAll(doc);
    const book = betBook(bets, budget, state.cards, settled, now);
    return { bets, book, earned, budget, balance: budget + book.net };
    // `minute`: odds and settlements move with the clock as race days finish.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, bets, doc, uid, minute]);
}
