import { betBook, type Bet } from '../core/champ/bets';
import { earnedCoins } from '../core/champ/coins';
import { normalizeShop, spent } from '../core/champ/shop';
import { settledResults } from '../core/champ/timing';
import type { RaceCard, RaceResult } from '../core/champ/types';

/**
 * Settling the bets, on the server (`core/champ/bets.ts`).
 *
 * Bets are private, so no browser can check another team's winnings - and a
 * team that spends what it won betting would otherwise get its car painted
 * the default colour by everybody else's check (`validLook`). So the server,
 * which alone can read every bet, works each team's book out from scratch
 * and publishes one number: `wallets/{uid}.betNet`, coins won minus coins
 * staked on finished bets. It says nothing about what was backed.
 *
 * Everything is recomputed every time from published data, so running it
 * twice, or late, writes the same numbers. Called by `raceResult` in
 * `functions/index.js` once a race day's broadcast is over.
 */
export interface WalletStore {
  allCards(): Promise<RaceCard[]>;
  allResults(cards: RaceCard[]): Promise<Map<string, RaceResult>>;
  allBets(): Promise<Array<{ uid: string; bet: Bet }>>;
  shop(uid: string): Promise<unknown>;
  putWallet(uid: string, betNet: number, now: number): Promise<void>;
}

/** Returns how many teams' wallets were written. */
export async function settleWallets(store: WalletStore, now: number = Date.now()): Promise<number> {
  const cards = await store.allCards();
  const results = await store.allResults(cards);
  const settled = settledResults(cards, results, now);
  const byUid = new Map<string, Bet[]>();
  for (const { uid, bet } of await store.allBets()) {
    const list = byUid.get(uid) ?? [];
    list.push(bet);
    byUid.set(uid, list);
  }
  let written = 0;
  for (const [uid, bets] of byUid) {
    const shop = normalizeShop(await store.shop(uid));
    // Duplicates in opened daily packs pay coins too (`packs.ts`).
    const earned = earnedCoins(uid, cards, settled, now, shop.gifts).total;
    const budget = earned - spent(shop.purchases);
    const book = betBook(bets, budget, cards, settled, now);
    await store.putWallet(uid, book.settledNet, now);
    written++;
  }
  return written;
}
