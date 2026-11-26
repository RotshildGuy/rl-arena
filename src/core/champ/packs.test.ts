import { describe, expect, it } from 'vitest';
import {
  CRAFT_COST,
  DUPE_CHIPS,
  PACK_TYPES,
  itemChance,
  locker,
  packContents,
  packPrizes,
  packRound,
  packSpent,
  packValid,
  rarityFor,
  teamPrizes,
  type PackRecord,
} from './packs';
import { ITEM_BY_ID, PACKS_SEASON, RARITIES, normalizeShop, spentAll, validLook } from './shop';
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

function pack(n: number, round = R, type: PackRecord['type'] = 'standard', boughtAt = lockAtForRound(round) - 3600_000): PackRecord {
  return { n, type, round, raceId: raceIdForRound(round), seasonId: seasonForRound(round), boughtAt };
}

describe('packs', () => {
  it('show odds that add up to a whole pack', () => {
    for (const t of PACK_TYPES) {
      expect(RARITIES.reduce((s, r) => s + t.odds[r], 0)).toBe(100);
      const total = packPrizes().reduce((s, it) => s + itemChance(t, it.id), 0);
      expect(total).toBeCloseTo(100, 6);
    }
    expect(rarityFor(0, PACK_TYPES[0].odds)).toBe('common');
    expect(rarityFor(0.9999, PACK_TYPES[0].odds)).toBe('legendary');
  });

  it('give the same prizes in every browser, and different ones for a different team, pack or seed', () => {
    const c = card(R);
    const a = packContents('team-a', pack(1), c);
    expect(packContents('team-a', pack(1), c)).toEqual(a);
    expect(a).toHaveLength(3);
    expect(new Set(a).size).toBe(3);
    for (const id of a) expect(ITEM_BY_ID.get(id)?.pack).toBe(true);
    const others = [packContents('team-b', pack(1), c), packContents('team-a', pack(2), c), packContents('team-a', pack(1), card(R, 999))];
    expect(others.some((o) => o.join() !== a.join())).toBe(true);
  });

  it('roughly follow the odds they show', () => {
    const counts: Record<string, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
    const c = card(R);
    for (let n = 1; n <= 2000; n++) for (const id of packContents(`u${n}`, pack(1), c)) counts[ITEM_BY_ID.get(id)!.rarity!]++;
    const all = 6000;
    expect(counts.common / all).toBeGreaterThan(0.6);
    expect(counts.common / all).toBeLessThan(0.76);
    expect(counts.legendary / all).toBeLessThan(0.03);
  });

  it('wait for the lock of their round, and count only when bought before it', () => {
    const p = pack(1, R + 1);
    expect(locker('u', [p], [], [card(R)]).waiting).toHaveLength(1);
    expect(locker('u', [p], [], [card(R), card(R + 1)]).opened).toHaveLength(1);
    // A thin grid that day: the next card opens it.
    expect(locker('u', [p], [], [card(R + 2)]).opened[0].card.round).toBe(R + 2);
    expect(packValid(pack(1, R, 'standard', lockAtForRound(R) + 1), 0)).toBe(false);
    expect(packValid(pack(2), 0)).toBe(false);
    expect(packValid(pack(1, R - 1), 0)).toBe(false);
    expect(packValid(pack(1), 0)).toBe(true);
  });

  it('turn duplicates into chips, and chips into a chosen prize', () => {
    const cards = [card(R)];
    const packs = [pack(1), pack(2)];
    // The same pack twice by forging its number would not count; find a real duplicate instead.
    const box = locker('u', packs, [], cards);
    const drawn = box.opened.flatMap((o) => o.items);
    const dupes = drawn.filter((x) => x.dupe);
    expect(box.chips).toBe(dupes.reduce((s, x) => s + DUPE_CHIPS[ITEM_BY_ID.get(x.id)!.rarity!], 0));
    expect(box.owned.size).toBe(drawn.length - dupes.length);
    // Too few chips: the chip purchase does not go through.
    const target = packPrizes().find((it) => it.rarity === 'legendary' && !box.owned.has(it.id))!;
    expect(box.chips).toBeLessThan(CRAFT_COST.legendary);
    expect(locker('u', packs, [target.id], cards).owned.has(target.id)).toBe(false);
  });

  it('craft only with chips actually won', () => {
    const many = Array.from({ length: 40 }, (_, i) => pack(i + 1));
    const box = locker('u', many, [], [card(R)]);
    expect(box.chips).toBeGreaterThan(0);
    const missing = packPrizes().filter((it) => !box.owned.has(it.id));
    const after = locker('u', many, missing.map((m) => m.id), [card(R)]);
    expect(after.chips).toBeGreaterThanOrEqual(0);
    expect(after.chips).toBeLessThanOrEqual(box.chips);
    for (const id of after.crafted) expect(missing.some((m) => m.id === id)).toBe(true);
  });

  it('cost coins, honest or not, and the look is checked against them', () => {
    const doc = normalizeShop({ purchases: ['color-navy'], equipped: {}, packs: [pack(1), pack(2, R, 'premium')] });
    expect(packSpent(doc.packs!)).toBe(PACK_TYPES[0].price + PACK_TYPES[1].price);
    expect(spentAll(doc)).toBe(120 + 350);
    expect(validLook(doc, 400)).toBeNull();
    expect(validLook(doc, 470)).not.toBeNull();
  });

  it('are the only way to own a prize: a written list proves nothing', () => {
    const cards = [card(R)];
    const won = teamPrizes('u', { packs: [pack(1)] }, cards);
    const id = [...won][0];
    const kind = ITEM_BY_ID.get(id)!.kind;
    const doc = { purchases: [], equipped: { [kind]: id }, packs: [pack(1)] };
    expect(validLook(doc, 1000, { won })).not.toBeNull();
    expect(validLook(doc, 1000)).toBeNull();
    // A prize nobody's packs gave, listed by hand.
    const other = packPrizes().find((it) => !won.has(it.id))!;
    expect(validLook({ purchases: [], equipped: { [other.kind]: other.id }, prizes: [other.id], packs: [pack(1)] }, 1000, { won })).toBeNull();
  });

  it('open on the next lock', () => {
    const r = packRound(lockAtForRound(R) - 1);
    expect(r).toBe(R);
    expect(packRound(lockAtForRound(R) + 1)).toBe(R + 1);
  });
});
