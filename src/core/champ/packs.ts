import { mulberry32 } from '../rng';
import { lockAtForRound, raceIdForRound, seasonForRound, seasonNumber } from './schedule';
import { ITEM_BY_ID, PACKS_SEASON, RARITIES, SHOP_ITEMS, type Rarity, type ShopItem } from './shop';
import type { RaceCard } from './types';

/**
 * Packs (ROADMAP 5.7, season 6): bought with coins, opened like a Rocket
 * League drop or a FIFA pack.
 *
 * Nothing about what a pack gave is stored. A pack is a record the team writes
 * when it buys it - its number, its type, and the round it opens on - and its
 * contents are a pure function of that record, the team's id, and the race
 * card of that round: the seed the server draws after the entry list locks,
 * and a fingerprint of every car's weights, which nobody but the server can
 * read. So a pack bought today opens at the next lock, nobody (the buyer
 * included) can know what is in it before then, and every browser works out
 * the same prizes for every team - the way it works out coins from results.
 *
 * The security rules make a pack record create-only and refuse one whose
 * round already has its card; `packValid` refuses one stamped after that
 * round's lock. Duplicates turn into chips, and chips buy a chosen prize.
 * There is no guaranteed rare after a run of bad luck (decided 24.11): every
 * pack has the odds it shows, every time.
 */

export type PackTypeId = 'standard' | 'premium';

export interface PackType {
  id: PackTypeId;
  price: number;
  /** Prizes in one pack, never the same one twice in the same pack. */
  items: number;
  /** Per prize, in percent: shown next to the pack. Sums to 100. */
  odds: Record<Rarity, number>;
}

/** Proposed defaults (awaiting the owner's go-ahead on prices and odds). */
export const PACK_TYPES: readonly PackType[] = [
  { id: 'standard', price: 100, items: 3, odds: { common: 68, rare: 24, epic: 7, legendary: 1 } },
  { id: 'premium', price: 250, items: 3, odds: { common: 35, rare: 40, epic: 20, legendary: 5 } },
];
export const PACK_BY_ID = new Map(PACK_TYPES.map((p) => [p.id, p]));

/** What a duplicate is worth, by its rarity. */
export const DUPE_CHIPS: Record<Rarity, number> = { common: 10, rare: 25, epic: 60, legendary: 150 };
/** What a chosen prize costs in chips, by its rarity. */
export const CRAFT_COST: Record<Rarity, number> = { common: 40, rare: 100, epic: 250, legendary: 600 };

/** How many packs one team may ever hold records for (the rules cap the list too). */
export const MAX_PACKS = 500;

/** One pack bought: stored in `shop/{uid}.packs`, in the order bought. */
export interface PackRecord {
  /** 1, 2, 3... - its place in the list. */
  n: number;
  type: PackTypeId;
  /** The round whose lock opens it: the next lock after it was bought. */
  round: number;
  raceId: string;
  seasonId: string;
  boughtAt: number;
}

let prizeList: readonly ShopItem[] | null = null;
/** Every prize a pack can give. Read lazily: `shop.ts` imports this module too. */
export function packPrizes(): readonly ShopItem[] {
  return (prizeList ??= SHOP_ITEMS.filter((i) => i.pack && i.rarity));
}

/** A stored list of pack records as read: anybody writes their own, so nothing is trusted. */
export function normalizePacks(raw: unknown): PackRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: PackRecord[] = [];
  for (const p of raw.slice(0, MAX_PACKS)) {
    if (!p || typeof p !== 'object') continue;
    const r = p as Record<string, unknown>;
    if (typeof r.type !== 'string' || !PACK_BY_ID.has(r.type as PackTypeId)) continue;
    if (!Number.isInteger(r.n) || !Number.isInteger(r.round) || typeof r.boughtAt !== 'number') continue;
    if (typeof r.raceId !== 'string' || typeof r.seasonId !== 'string') continue;
    out.push({ n: r.n as number, type: r.type as PackTypeId, round: r.round as number, raceId: r.raceId, seasonId: r.seasonId, boughtAt: r.boughtAt });
  }
  return out;
}

/** Coins spent on packs. Every pack recorded counts, honest or not: a forged one still costs. */
export function packSpent(packs: PackRecord[]): number {
  return packs.reduce((s, p) => s + (PACK_BY_ID.get(p.type)?.price ?? 0), 0);
}

/**
 * A pack whose contents count: in its place in the list, of a season that has
 * packs, and bought before the lock of the round it names. The rules refuse a
 * pack whose card already exists; this refuses one stamped late.
 */
export function packValid(p: PackRecord, index: number): boolean {
  return (
    p.n === index + 1 &&
    seasonNumber(p.round) >= PACKS_SEASON &&
    p.raceId === raceIdForRound(p.round) &&
    p.seasonId === seasonForRound(p.round) &&
    p.boughtAt < lockAtForRound(p.round)
  );
}

/** The round a pack is opened on, for a new pack bought now: the next lock. */
export function packRound(now: number): number {
  let r = Math.max(1, Math.floor((now - lockAtForRound(1)) / (24 * 60 * 60 * 1000)));
  while (lockAtForRound(r) <= now) r++;
  while (r > 1 && lockAtForRound(r - 1) > now) r--;
  return r;
}

/**
 * The card a pack opens on: its round's, or - if that day had too thin a grid
 * to race - the first card after it. Either way one made after the pack was bought.
 */
export function openingCard(p: PackRecord, cards: RaceCard[]): RaceCard | null {
  let best: RaceCard | null = null;
  for (const c of cards) if (c.round >= p.round && (!best || c.round < best.round)) best = c;
  return best;
}

function fnv(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** What nobody knows before the lock: the drawn seed, the moment the card was made, every car's fingerprint. */
export function cardSecret(card: RaceCard): string {
  const prints = Object.entries(card.fingerprints ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, f]) => `${id}:${f}`)
    .join(',');
  const quali = card.qualifying.map((q) => `${q.entryId}:${q.bestLapMs ?? '-'}`).join(',');
  return `${card.id}|${card.seed}|${card.createdAt}|${prints}|${quali}`;
}

/** The rarity a roll in [0, 1) lands on, by a pack's odds. */
export function rarityFor(roll: number, odds: Record<Rarity, number>): Rarity {
  let acc = 0;
  for (const r of RARITIES) {
    acc += odds[r] / 100;
    if (roll < acc) return r;
  }
  return 'common';
}

/** What is in a pack: prize ids, in the order they are revealed. */
export function packContents(uid: string, p: PackRecord, card: RaceCard): string[] {
  const type = PACK_BY_ID.get(p.type)!;
  const rng = mulberry32(fnv(`${uid}|${p.n}|${p.type}|${cardSecret(card)}`));
  const out: string[] = [];
  for (let i = 0; i < type.items; i++) {
    const rarity = rarityFor(rng(), type.odds);
    const pool = packPrizes().filter((x) => x.rarity === rarity && !out.includes(x.id));
    const from = pool.length ? pool : packPrizes().filter((x) => !out.includes(x.id));
    out.push(from[Math.min(from.length - 1, Math.floor(rng() * from.length))].id);
  }
  // The best one last, the way a pack is opened.
  return out.sort((a, b) => RARITIES.indexOf(ITEM_BY_ID.get(a)!.rarity!) - RARITIES.indexOf(ITEM_BY_ID.get(b)!.rarity!));
}

export interface OpenedPack {
  pack: PackRecord;
  card: RaceCard;
  items: Array<{ id: string; dupe: boolean; chips: number }>;
}

export interface Locker {
  /** Every prize the team owns: won in a pack or bought with chips. */
  owned: Set<string>;
  chips: number;
  opened: OpenedPack[];
  /** Bought, waiting for their lock. */
  waiting: PackRecord[];
  /** Records that do not count: bought late, or out of place. They still cost coins. */
  invalid: PackRecord[];
  /** The chip purchases that went through. */
  crafted: string[];
}

/**
 * A team's prizes, worked out from scratch: every honest pack in order (a
 * prize the team already has is a duplicate, worth chips), then every chip
 * purchase in order, each taken only if the chips are there. The same in
 * every browser, from public data.
 */
export function locker(uid: string, packs: PackRecord[], crafted: string[], cards: RaceCard[]): Locker {
  const owned = new Set<string>();
  let chips = 0;
  const opened: OpenedPack[] = [];
  const waiting: PackRecord[] = [];
  const invalid: PackRecord[] = [];
  packs.forEach((p, i) => {
    if (!packValid(p, i)) return void invalid.push(p);
    const card = openingCard(p, cards);
    if (!card) return void waiting.push(p);
    const items = packContents(uid, p, card).map((id) => {
      const dupe = owned.has(id);
      const worth = dupe ? DUPE_CHIPS[ITEM_BY_ID.get(id)!.rarity!] : 0;
      chips += worth;
      owned.add(id);
      return { id, dupe, chips: worth };
    });
    opened.push({ pack: p, card, items });
  });
  const took: string[] = [];
  for (const id of crafted) {
    const it = ITEM_BY_ID.get(id);
    if (!it?.pack || !it.rarity || owned.has(id)) continue;
    const cost = CRAFT_COST[it.rarity];
    if (cost > chips) continue;
    chips -= cost;
    owned.add(id);
    took.push(id);
  }
  return { owned, chips, opened, waiting, invalid, crafted: took };
}

/** The chance, in percent, that one prize of a pack is this particular item. */
export function itemChance(type: PackType, id: string): number {
  const rarity = ITEM_BY_ID.get(id)?.rarity;
  if (!rarity) return 0;
  return type.odds[rarity] / packPrizes().filter((x) => x.rarity === rarity).length;
}

/** A team's prizes from its shop document, as `validLook` takes them (`opts.won`). */
export function teamPrizes(uid: string, doc: { packs?: PackRecord[]; crafted?: string[] }, cards: RaceCard[]): Set<string> {
  if (!doc.packs?.length) return new Set();
  return locker(uid, doc.packs, doc.crafted ?? [], cards).owned;
}
