import { mulberry32 } from '../rng';
import { lockAtForRound, raceIdForRound, seasonForRound, seasonNumber } from './schedule';
import { ITEM_BY_ID, PACKS_SEASON, RARITIES, SHOP_ITEMS, type Rarity, type ShopItem } from './shop';
import type { RaceCard } from './types';

/**
 * Packs (ROADMAP 5.7, season 6): a gift, never bought.
 *
 * Every day a team opens the game it gets one pack. Three days in a row and
 * the third day's pack is a premium one instead (then the count starts again:
 * days 3, 6, 9... of an unbroken run are premium). Nothing about a pack is
 * for sale, and neither is anything inside one.
 *
 * A day is a UTC day: it turns at 02:00 Israel time in winter and 03:00 in
 * summer, so a whole race evening (19:55 to about 22:00) is always the same
 * gift day. The security rules can check a UTC day against the server clock
 * without knowing about daylight saving.
 *
 * Nothing about what a pack gave is stored. A claim is a record the team
 * writes in `shop/{uid}.gifts` - the day, the moment, and the round whose
 * lock opens it - and the pack's contents are a pure function of that record,
 * the team's id and the race card of that round: the seed the server draws
 * after the entry list locks, and a fingerprint of every car's weights, which
 * nobody but the server can read. So nobody, the team included, can know what
 * is in a pack before its lock, and every browser works out the same prizes
 * for every team - the way it works out coins from results.
 *
 * The rules allow one claim per day, dated by the server's clock, and refuse
 * one whose round already has its card; `giftValid` refuses one stamped after
 * that round's lock. A duplicate pays coins, by its rarity (see `locker`):
 * worked out from the same public data, so every browser agrees on them.
 */

export type PackTypeId = 'standard' | 'premium';

export interface PackType {
  id: PackTypeId;
  /** Prizes in one pack, never the same one twice in the same pack. */
  items: number;
  /** Per prize, in percent: shown next to the pack. Sums to 100. */
  odds: Record<Rarity, number>;
}

export const PACK_TYPES: readonly PackType[] = [
  { id: 'standard', items: 3, odds: { common: 68, rare: 24, epic: 7, legendary: 1 } },
  { id: 'premium', items: 3, odds: { common: 35, rare: 40, epic: 20, legendary: 5 } },
];
export const PACK_BY_ID = new Map(PACK_TYPES.map((p) => [p.id, p]));

/** Every this many days in a row, the day's pack is premium. */
export const STREAK_DAYS = 3;

/** The coins a duplicate pays, by its rarity: spendable once its pack opens. */
export const DUPE_COINS: Record<Rarity, number> = { common: 10, rare: 25, epic: 60, legendary: 150 };

/** How many claims a team's document may hold (the rules cap the list too): years of days. */
export const MAX_GIFTS = 2000;

export const DAY_MS = 24 * 60 * 60 * 1000;

/** The gift day of a moment: days since 1.1.1970, UTC. */
export function giftDay(ms: number): number {
  return Math.floor(ms / DAY_MS);
}

/** One daily pack claimed: stored in `shop/{uid}.gifts`, in day order. */
export interface GiftRecord {
  /** The gift day (`giftDay`), by the server's clock. */
  day: number;
  /** When it was claimed. */
  at: number;
  /** The round whose lock opens it: the next lock after it was claimed. */
  round: number;
  raceId: string;
  seasonId: string;
}

let prizeList: readonly ShopItem[] | null = null;
/** Every prize a pack can give. Read lazily: `shop.ts` imports this module too. */
export function packPrizes(): readonly ShopItem[] {
  return (prizeList ??= SHOP_ITEMS.filter((i) => i.pack && i.rarity));
}

/** A stored list of claims as read: anybody writes their own, so nothing is trusted. */
export function normalizeGifts(raw: unknown): GiftRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: GiftRecord[] = [];
  for (const g of raw.slice(0, MAX_GIFTS)) {
    if (!g || typeof g !== 'object') continue;
    const r = g as Record<string, unknown>;
    if (!Number.isInteger(r.day) || !Number.isInteger(r.round) || typeof r.at !== 'number') continue;
    if (typeof r.raceId !== 'string' || typeof r.seasonId !== 'string') continue;
    out.push({ day: r.day as number, at: r.at, round: r.round as number, raceId: r.raceId, seasonId: r.seasonId });
  }
  return out;
}

/**
 * A claim whose pack counts: of a season that has packs, stamped on the day
 * it names (give or take the five minutes the rules allow a clock), and
 * before the lock of the round it names. The rules refuse a claim whose card
 * already exists; this refuses one stamped late.
 */
export function giftValid(g: GiftRecord): boolean {
  const slack = 5 * 60 * 1000;
  return (
    seasonNumber(g.round) >= PACKS_SEASON &&
    g.raceId === raceIdForRound(g.round) &&
    g.seasonId === seasonForRound(g.round) &&
    g.at < lockAtForRound(g.round) &&
    g.at >= g.day * DAY_MS - slack &&
    g.at < (g.day + 1) * DAY_MS + slack
  );
}

/** The round a pack claimed now opens on: the next lock. */
export function packRound(now: number): number {
  let r = Math.max(1, Math.floor((now - lockAtForRound(1)) / DAY_MS));
  while (lockAtForRound(r) <= now) r++;
  while (r > 1 && lockAtForRound(r - 1) > now) r--;
  return r;
}

/** Whether packs are given at all at this moment: from the season they open in. */
export function packsOpen(now: number): boolean {
  return seasonNumber(packRound(now)) >= PACKS_SEASON;
}

/** The claim a team would write now. */
export function newGift(now: number): GiftRecord {
  const round = packRound(now);
  return { day: giftDay(now), at: now, round, raceId: raceIdForRound(round), seasonId: seasonForRound(round) };
}

/**
 * The honest claims, in day order, each with its pack type: the
 * `STREAK_DAYS`th, 2*`STREAK_DAYS`th... day of an unbroken run of days is premium.
 */
export function giftPacks(gifts: GiftRecord[]): Array<{ gift: GiftRecord; type: PackTypeId; streak: number }> {
  const out: Array<{ gift: GiftRecord; type: PackTypeId; streak: number }> = [];
  let last = -Infinity;
  let streak = 0;
  for (const g of gifts) {
    // One a day, in order: anything else is not a claim the rules let through.
    if (g.day <= last || !giftValid(g)) continue;
    streak = g.day === last + 1 ? streak + 1 : 1;
    last = g.day;
    out.push({ gift: g, type: streak % STREAK_DAYS === 0 ? 'premium' : 'standard', streak });
  }
  return out;
}

/** Days in a row up to `today`: today counts once claimed, and a run that ended yesterday is still alive. */
export function currentStreak(gifts: GiftRecord[], today: number): number {
  const packs = giftPacks(gifts);
  const last = packs[packs.length - 1];
  if (!last || last.gift.day < today - 1) return 0;
  return last.streak;
}

/**
 * The card a pack opens on: its round's, or - if that day had too thin a grid
 * to race - the first card after it. Either way one made after the claim.
 */
export function openingCard(g: GiftRecord, cards: RaceCard[]): RaceCard | null {
  let best: RaceCard | null = null;
  for (const c of cards) if (c.round >= g.round && (!best || c.round < best.round)) best = c;
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

/** What is in a pack: prize ids, in the order they are revealed (the rarest last). */
export function packContents(uid: string, day: number, type: PackTypeId, card: RaceCard): string[] {
  const pack = PACK_BY_ID.get(type)!;
  const rng = mulberry32(fnv(`${uid}|${day}|${type}|${cardSecret(card)}`));
  const out: string[] = [];
  for (let i = 0; i < pack.items; i++) {
    const rarity = rarityFor(rng(), pack.odds);
    const pool = packPrizes().filter((x) => x.rarity === rarity && !out.includes(x.id));
    const from = pool.length ? pool : packPrizes().filter((x) => !out.includes(x.id));
    out.push(from[Math.min(from.length - 1, Math.floor(rng() * from.length))].id);
  }
  return out.sort((a, b) => RARITIES.indexOf(ITEM_BY_ID.get(a)!.rarity!) - RARITIES.indexOf(ITEM_BY_ID.get(b)!.rarity!));
}

export interface OpenedPack {
  gift: GiftRecord;
  type: PackTypeId;
  card: RaceCard;
  items: Array<{ id: string; dupe: boolean; coins: number }>;
}

export interface Locker {
  /** Every prize the team's packs gave. */
  owned: Set<string>;
  /** Coins from duplicates, in packs already opened. */
  coins: number;
  opened: OpenedPack[];
  /** Claimed, waiting for their lock. */
  waiting: Array<{ gift: GiftRecord; type: PackTypeId }>;
}

/**
 * A team's packs, worked out from scratch: every honest pack in day order
 * whose lock has come; a prize the team already has is a duplicate, worth
 * coins. The same in every browser, from public data.
 */
export function locker(uid: string, gifts: GiftRecord[], cards: RaceCard[]): Locker {
  const owned = new Set<string>();
  let coins = 0;
  const opened: OpenedPack[] = [];
  const waiting: Locker['waiting'] = [];
  for (const { gift, type } of giftPacks(gifts)) {
    const card = openingCard(gift, cards);
    if (!card) {
      waiting.push({ gift, type });
      continue;
    }
    const items = packContents(uid, gift.day, type, card).map((id) => {
      const dupe = owned.has(id);
      const worth = dupe ? DUPE_COINS[ITEM_BY_ID.get(id)!.rarity!] : 0;
      coins += worth;
      owned.add(id);
      return { id, dupe, coins: worth };
    });
    opened.push({ gift, type, card, items });
  }
  return { owned, coins, opened, waiting };
}

/** The chance, in percent, that one prize of a pack is this particular item. */
export function itemChance(type: PackType, id: string): number {
  const rarity = ITEM_BY_ID.get(id)?.rarity;
  if (!rarity) return 0;
  return type.odds[rarity] / packPrizes().filter((x) => x.rarity === rarity).length;
}

/**
 * What a team's packs gave, from its gift claims: the prizes (`validLook`'s
 * `opts.won`) and the coins from duplicates (`earnedCoins`' `gifts`).
 * Worked out once per claim list and set of cards.
 */
const lockerCache = new WeakMap<object, WeakMap<object, Map<string, Locker>>>();
export function teamLocker(uid: string, gifts: GiftRecord[] | undefined, cards: RaceCard[]): Locker {
  if (!uid || !gifts?.length) return { owned: new Set(), coins: 0, opened: [], waiting: [] };
  let byCards = lockerCache.get(gifts);
  if (!byCards) lockerCache.set(gifts, (byCards = new WeakMap()));
  let byUid = byCards.get(cards);
  if (!byUid) byCards.set(cards, (byUid = new Map()));
  let box = byUid.get(uid);
  if (!box) byUid.set(uid, (box = locker(uid, gifts, cards)));
  return box;
}

/** A team's prizes from its shop document, as `validLook` takes them (`opts.won`). */
export function teamPrizes(uid: string, doc: { gifts?: GiftRecord[] }, cards: RaceCard[]): Set<string> {
  return teamLocker(uid, doc.gifts, cards).owned;
}
