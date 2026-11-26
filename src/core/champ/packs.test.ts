import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  DUPE_COINS,
  PACK_TYPES,
  currentStreak,
  giftDay,
  giftPacks,
  giftValid,
  itemChance,
  locker,
  newGift,
  packContents,
  packPrizes,
  packRound,
  rarityFor,
  teamPrizes,
  type GiftRecord,
} from './packs';
import { ITEM_BY_ID, PACKS_SEASON, RARITIES, SHOP_ITEMS, normalizeShop, spent, validLook } from './shop';
import { TITLES, QUOTES } from './prizeSet';
import { earnedCoins } from './coins';
import { lockAtForRound, raceIdForRound, seasonForRound, seasonRange } from './schedule';
import type { RaceCard } from './types';

const R = seasonRange(PACKS_SEASON).first;

function card(round: number, seed = 12345): RaceCard {
  return {
    id: raceIdForRound(round),
    seasonId: seasonForRound(round),
    round,
    name: '',
    trackId: 't',
    laps: 3,
    seed,
    startsAt: lockAtForRound(round) + 5 * 60_000,
    entries: [],
    qualifying: [{ entryId: 'a', bestLapMs: 61234, sectorsMs: [], topSpeed: 1 }],
    createdAt: lockAtForRound(round) + 1000,
    fingerprints: { a: 'f00d' },
  };
}

/** A claim made in the morning (UTC) of round `round`'s day, before its lock. */
function gift(round: number): GiftRecord {
  const at = lockAtForRound(round) - 10 * 60 * 60 * 1000;
  return newGift(at);
}

/** Claims on every day of rounds R .. R+n-1, and a card for each. */
function days(n: number): { gifts: GiftRecord[]; cards: RaceCard[] } {
  const rounds = Array.from({ length: n }, (_, i) => R + i);
  return { gifts: rounds.map(gift), cards: rounds.map((r) => card(r)) };
}

describe('daily packs', () => {
  it('show odds that add up to a whole pack', () => {
    for (const t of PACK_TYPES) {
      expect(RARITIES.reduce((s, r) => s + t.odds[r], 0)).toBe(100);
      expect(packPrizes().reduce((s, it) => s + itemChance(t, it.id), 0)).toBeCloseTo(100, 6);
    }
    expect(rarityFor(0, PACK_TYPES[0].odds)).toBe('common');
    expect(rarityFor(0.9999, PACK_TYPES[0].odds)).toBe('legendary');
  });

  it('give the same prizes in every browser, and different ones for another team, day or seed', () => {
    const c = card(R);
    const a = packContents('team-a', 100, 'standard', c);
    expect(packContents('team-a', 100, 'standard', c)).toEqual(a);
    expect(a).toHaveLength(3);
    expect(new Set(a).size).toBe(3);
    for (const id of a) expect(ITEM_BY_ID.get(id)?.pack).toBe(true);
    const others = [
      packContents('team-b', 100, 'standard', c),
      packContents('team-a', 101, 'standard', c),
      packContents('team-a', 100, 'standard', card(R, 999)),
    ];
    expect(others.some((o) => o.join() !== a.join())).toBe(true);
  });

  it('roughly follow the odds they show', () => {
    const counts: Record<string, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
    const c = card(R);
    for (let n = 1; n <= 2000; n++) for (const id of packContents(`u${n}`, 1, 'standard', c)) counts[ITEM_BY_ID.get(id)!.rarity!]++;
    expect(counts.common / 6000).toBeGreaterThan(0.6);
    expect(counts.common / 6000).toBeLessThan(0.76);
    expect(counts.legendary / 6000).toBeLessThan(0.03);
  });

  it('come one a day, and every third day in a row is premium', () => {
    const { gifts } = days(7);
    expect(giftPacks(gifts).map((p) => p.type)).toEqual(['standard', 'standard', 'premium', 'standard', 'standard', 'premium', 'standard']);
    // A missed day starts the count again.
    const gap = [gifts[0], gifts[1], gifts[3], gifts[4], gifts[5]];
    expect(giftPacks(gap).map((p) => p.type)).toEqual(['standard', 'standard', 'standard', 'standard', 'premium']);
    // Two claims for one day: only the first counts.
    expect(giftPacks([gifts[0], { ...gifts[0], at: gifts[0].at + 1000 }])).toHaveLength(1);
    expect(currentStreak(gifts.slice(0, 2), gifts[1].day)).toBe(2);
    expect(currentStreak(gifts.slice(0, 2), gifts[1].day + 1)).toBe(2);
    expect(currentStreak(gifts.slice(0, 2), gifts[1].day + 2)).toBe(0);
  });

  it('wait for the lock of their round, and count only when claimed before it, on their day', () => {
    const g = gift(R + 1);
    expect(locker('u', [g], [card(R)]).waiting).toHaveLength(1);
    expect(locker('u', [g], [card(R), card(R + 1)]).opened).toHaveLength(1);
    // A thin grid that day: the next card opens it.
    expect(locker('u', [g], [card(R + 2)]).opened[0].card.round).toBe(R + 2);
    expect(giftValid(g)).toBe(true);
    expect(giftValid({ ...g, at: lockAtForRound(g.round) + 1, day: giftDay(lockAtForRound(g.round) + 1) })).toBe(false);
    expect(giftValid({ ...g, day: g.day - 3 })).toBe(false);
    expect(giftValid(gift(R - 1))).toBe(false);
    expect(packRound(lockAtForRound(R) - 1)).toBe(R);
    expect(packRound(lockAtForRound(R) + 1)).toBe(R + 1);
  });

  it('pay coins for duplicates, counted with the rest of the income once the pack opens', () => {
    const { gifts, cards } = days(40);
    const box = locker('u', gifts, cards);
    const drawn = box.opened.flatMap((o) => o.items);
    const dupes = drawn.filter((x) => x.dupe);
    expect(dupes.length).toBeGreaterThan(0);
    expect(box.coins).toBe(dupes.reduce((s, x) => s + DUPE_COINS[ITEM_BY_ID.get(x.id)!.rarity!], 0));
    expect(box.owned.size).toBe(drawn.length - dupes.length);
    // Every browser counts them in the wallet, from the claims and the cards alone.
    const none = new Map();
    expect(earnedCoins('u', cards, none, 0, gifts).total).toBe(box.coins);
    expect(earnedCoins('u', cards, none, 0).total).toBe(0);
    // A pack still waiting for its lock pays nothing yet.
    const early = locker('u', gifts, cards.slice(0, 20));
    expect(early.waiting).toHaveLength(20);
    expect(earnedCoins('u', cards.slice(0, 20), none, 0, gifts).total).toBe(early.coins);
    expect(early.coins).toBeLessThanOrEqual(box.coins);
  });

  it('cost nothing: no pack and no prize is ever bought with coins', () => {
    const { gifts } = days(5);
    const doc = normalizeShop({ purchases: ['color-navy'], equipped: {}, gifts });
    expect(spent(doc.purchases)).toBe(120);
    expect(spent(packPrizes().map((p) => p.id))).toBe(0);
    for (const it of SHOP_ITEMS.filter((i) => i.pack)) expect(it.price).toBe(0);
  });

  it('are the only way to own a prize: a written list proves nothing', () => {
    const { gifts, cards } = days(1);
    const won = teamPrizes('u', { gifts }, cards);
    const id = [...won][0];
    const kind = ITEM_BY_ID.get(id)!.kind;
    const doc = { purchases: [], equipped: { [kind]: id }, gifts };
    expect(validLook(doc, 1000, { won })).not.toBeNull();
    expect(validLook(doc, 1000)).toBeNull();
    const other = packPrizes().find((it) => !won.has(it.id))!;
    expect(validLook({ purchases: [], equipped: { [other.kind]: other.id }, prizes: [other.id], gifts }, 1000, { won })).toBeNull();
  });

  it('day boundaries are UTC days', () => {
    expect(giftDay(0)).toBe(0);
    expect(giftDay(DAY_MS - 1)).toBe(0);
    expect(giftDay(DAY_MS)).toBe(1);
  });
});

describe('the prize catalogue', () => {
  it('is big enough that a daily pack keeps finding something new', () => {
    const prizes = packPrizes();
    expect(prizes.length).toBeGreaterThanOrEqual(250);
    const count = (r: string) => prizes.filter((p) => p.rarity === r).length;
    expect(count('common')).toBeGreaterThan(count('rare'));
    expect(count('rare')).toBeGreaterThan(count('epic'));
    expect(count('epic')).toBeGreaterThan(count('legendary'));
  });

  it('has titles and quotes short enough to fit, in both languages', () => {
    for (const x of [...TITLES, ...QUOTES]) {
      expect(x.he.length).toBeLessThanOrEqual(40);
      expect(x.en.length).toBeLessThanOrEqual(45);
      // The house style's long dash, by its code so this file does not hold one either.
      const dash = String.fromCharCode(0x2014);
      expect(x.he.includes(dash) || x.en.includes(dash)).toBe(false);
    }
  });
});
