import type { CarLook, CelebrationKind } from '../games/racing/render';
import { DEFAULT_EMBLEM, normalizeEmblem, type Emblem } from './emblem';
import { t, translated } from '../../i18n/dict';
import { teamColor, teamLook } from './livery';
import { normalizePacks, packSpent, type PackRecord } from './packs';

/**
 * The catalogue. Everything here is paint: it changes how a car is drawn and
 * never how it drives. Prices are constants, so a purchase only has to record
 * which item - and a forged price is not a thing that can exist.
 *
 * No purple, green or yellow body colours: those mean fastest lap, personal
 * best and slower on every timing screen, and a car painted in them would
 * read as a lap time.
 */
export type ItemKind =
  | 'color' | 'secondary' | 'pattern' | 'number' | 'helmet' | 'smoke'
  | 'shape' | 'wing' | 'rim' | 'emblem' | 'celebration'
  // Pack prizes (season 6): never sold, only found in packs.
  | 'trail' | 'flame' | 'visor' | 'decal' | 'engine' | 'finish'
  | 'trophy' | 'frame' | 'title' | 'banner' | 'quote';

/** How rare a pack prize is: what a pack shows its odds by. */
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];

/**
 * The season packs open from (ROADMAP 5.7). Until then the prizes are in the
 * catalogue - drawn, heard and shown in the shop's preview - but nobody can
 * own one, and a look that wears one is not honoured (`validLook`).
 */
export const PACKS_SEASON = 6;

export interface ShopItem {
  id: string;
  kind: ItemKind;
  label: string;
  price: number;
  /** The colour, pattern or shape name or, for `number` and `emblem`, empty (those are chosen). */
  value: string;
  /**
   * No longer sold. A team that bought one keeps it and can still put it on or
   * take it off; nobody else sees it in the shop. Kept in the catalogue so the
   * coins paid still count and the paint still draws.
   */
  retired?: boolean;
  /** A pack prize: not for sale at any price, only found in a pack. */
  pack?: boolean;
  rarity?: Rarity;
}

/** An item whose label is read from the dictionary by its id. */
const item = (base: Omit<ShopItem, 'label'>): ShopItem => translated(base, () => ({ label: t().shopItems[base.id] ?? base.id }));

const color = (id: string, value: string, price = 120): ShopItem => item({ id, kind: 'color', price, value });
/** The second colour: the stripe, the rear half of a two-tone, and the wings. */
const second = (id: string, value: string, price = 60): ShopItem => item({ id, kind: 'secondary', price, value });
/** Wings in a colour of their own, over whatever the second colour would paint them. */
const wing = (id: string, value: string): ShopItem => item({ id, kind: 'wing', price: 60, value });
/** The wheel rims, and a band of the same colour round each tyre wall. */
const rim = (id: string, value: string): ShopItem => item({ id, kind: 'rim', price: 50, value });
/** What plays over the car when it stands on the podium. */
const celebration = (id: string, value: CelebrationKind, price: number): ShopItem => item({ id, kind: 'celebration', price, value });

/** A pack prize. Its price is 0 only so that it adds nothing to `spent`: it cannot be bought. */
const prize = (id: string, kind: ItemKind, value: string, rarity: Rarity): ShopItem =>
  item({ id, kind, price: 0, value, pack: true, rarity });

export const SHOP_ITEMS: ShopItem[] = [
  color('color-scarlet', '#ff2e4d'),
  color('color-crimson', '#b3122e'),
  color('color-orange', '#ff7a1a'),
  color('color-sky', '#38bdf8'),
  color('color-navy', '#2346c8'),
  color('color-teal', '#14b8a6'),
  color('color-pink', '#ff5fa2'),
  color('color-silver', '#c8d0de', 160),
  color('color-graphite', '#3a404f', 160),
  color('color-white', '#f4f6fb', 160),
  second('second-white', '#f4f6fb'),
  second('second-black', '#14161d'),
  second('second-scarlet', '#ff2e4d'),
  second('second-orange', '#ff7a1a'),
  second('second-sky', '#38bdf8'),
  second('second-navy', '#2346c8'),
  second('second-teal', '#14b8a6'),
  second('second-pink', '#ff5fa2'),
  second('second-silver', '#c8d0de'),
  item({ id: 'pattern-stripe', kind: 'pattern', price: 80, value: 'stripe' }),
  item({ id: 'pattern-twotone', kind: 'pattern', price: 80, value: 'twotone' }),
  item({ id: 'pattern-solid', kind: 'pattern', price: 0, value: 'solid' }),
  // Season 2. An id once sold is never reused.
  item({ id: 'pattern-chevron', kind: 'pattern', price: 80, value: 'chevron' }),
  item({ id: 'pattern-centerline', kind: 'pattern', price: 80, value: 'centerline' }),
  item({ id: 'pattern-fade', kind: 'pattern', price: 80, value: 'fade' }),
  item({ id: 'number', kind: 'number', price: 60, value: '' }),
  item({ id: 'helmet-gold', kind: 'helmet', price: 50, value: '#e6b422' }),
  item({ id: 'helmet-black', kind: 'helmet', price: 40, value: '#14161d' }),
  item({ id: 'helmet-red', kind: 'helmet', price: 40, value: '#ff2e4d' }),
  item({ id: 'smoke-blue', kind: 'smoke', price: 70, value: 'rgba(80, 150, 255, 0.28)' }),
  item({ id: 'smoke-red', kind: 'smoke', price: 70, value: 'rgba(255, 70, 90, 0.26)' }),
  item({ id: 'smoke-white', kind: 'smoke', price: 50, value: 'rgba(235, 240, 250, 0.32)' }),
  // Body shapes: drawing only, every one the same `CAR_RADIUS` in the physics.
  item({ id: 'shape-classic', kind: 'shape', price: 0, value: 'classic' }),
  item({ id: 'shape-wedge', kind: 'shape', price: 120, value: 'wedge' }),
  item({ id: 'shape-arrow', kind: 'shape', price: 120, value: 'arrow' }),
  item({ id: 'shape-bulldog', kind: 'shape', price: 120, value: 'bulldog' }),
  wing('wing-white', '#f4f6fb'),
  wing('wing-black', '#14161d'),
  wing('wing-scarlet', '#ff2e4d'),
  wing('wing-orange', '#ff7a1a'),
  wing('wing-sky', '#38bdf8'),
  wing('wing-navy', '#2346c8'),
  wing('wing-teal', '#14b8a6'),
  wing('wing-pink', '#ff5fa2'),
  wing('wing-silver', '#c8d0de'),
  rim('rim-silver', '#c8d0de'),
  rim('rim-black', '#2a2d36'),
  rim('rim-gold', '#e6b422'),
  rim('rim-red', '#ff2e4d'),
  rim('rim-sky', '#38bdf8'),
  // Unlocks the emblem builder; everything chosen inside it is free.
  item({ id: 'emblem', kind: 'emblem', price: 100, value: '' }),
  // Season 4: played over the team's car on the podium. Nothing on track.
  celebration('celebrate-sparkles', 'sparkles', 60),
  celebration('celebrate-confetti', 'confetti', 80),
  celebration('celebrate-bubbles', 'bubbles', 80),
  celebration('celebrate-balloons', 'balloons', 100),
  celebration('celebrate-champagne', 'champagne', 120),
  celebration('celebrate-fireworks', 'fireworks', 150),

  // Pack prizes, for season 6 (ROADMAP 5.7). Paint and show only, like everything above.
  // A trail behind the car at speed.
  prize('trail-white', 'trail', 'rgba(240, 244, 255, 0.55)', 'common'),
  prize('trail-sky', 'trail', 'rgba(56, 189, 248, 0.6)', 'rare'),
  prize('trail-scarlet', 'trail', 'rgba(255, 46, 77, 0.6)', 'rare'),
  prize('trail-gold', 'trail', 'rgba(230, 180, 34, 0.7)', 'epic'),
  prize('trail-rainbow', 'trail', 'rainbow', 'legendary'),
  // A flame out of the exhaust while the car is on the throttle: core | outer.
  prize('flame-orange', 'flame', '#ffe08a|#ff7a1a', 'common'),
  prize('flame-blue', 'flame', '#e0f4ff|#2f8bff', 'rare'),
  prize('flame-pink', 'flame', '#ffe0ef|#ff5fa2', 'epic'),
  prize('flame-plasma', 'flame', '#ffffff|#38f0ff', 'legendary'),
  // A design on the helmet, in the second colour.
  prize('visor-stripe', 'visor', 'stripe', 'common'),
  prize('visor-checker', 'visor', 'checker', 'rare'),
  prize('visor-star', 'visor', 'star', 'rare'),
  prize('visor-flames', 'visor', 'flames', 'epic'),
  prize('visor-crown', 'visor', 'crown', 'legendary'),
  // A sticker on both sidepods, from a closed set: no free text to moderate.
  prize('decal-star', 'decal', 'star', 'common'),
  prize('decal-bolt', 'decal', 'bolt', 'common'),
  prize('decal-checker', 'decal', 'checker', 'rare'),
  prize('decal-flame', 'decal', 'flame', 'rare'),
  prize('decal-sun', 'decal', 'sun', 'epic'),
  prize('decal-crown', 'decal', 'crown', 'legendary'),
  // Painted versions of the wings and rims, in colours the shop does not sell.
  prize('wing-titanium', 'wing', '#9aa7b8', 'rare'),
  prize('wing-cobalt', 'wing', '#1d4ed8', 'rare'),
  prize('wing-gold', 'wing', '#e6b422', 'epic'),
  prize('rim-titanium', 'rim', '#9aa7b8', 'rare'),
  prize('rim-cobalt', 'rim', '#1d4ed8', 'rare'),
  prize('rim-chrome', 'rim', '#eef2f8', 'epic'),
  // How the car sounds, to whoever has the sound on.
  prize('engine-v8', 'engine', 'v8', 'rare'),
  prize('engine-turbo', 'engine', 'turbo', 'rare'),
  prize('engine-v10', 'engine', 'v10', 'epic'),
  prize('engine-electric', 'engine', 'electric', 'legendary'),
  // Played where the winner crosses the line.
  prize('finish-shockwave', 'finish', 'shockwave', 'rare'),
  prize('finish-sparks', 'finish', 'sparks', 'epic'),
  prize('finish-stars', 'finish', 'stars', 'legendary'),
  // The trophy over the winner on the podium. Six, one of them legendary.
  prize('trophy-cup', 'trophy', 'cup', 'common'),
  prize('trophy-laurel', 'trophy', 'laurel', 'rare'),
  prize('trophy-star', 'trophy', 'star', 'rare'),
  prize('trophy-wheel', 'trophy', 'wheel', 'epic'),
  prize('trophy-crown', 'trophy', 'crown', 'epic'),
  prize('trophy-diamond', 'trophy', 'diamond', 'legendary'),
  // The frame round a driver's place in the timing tower and on the podium.
  prize('frame-bronze', 'frame', 'bronze', 'common'),
  prize('frame-silver', 'frame', 'silver', 'rare'),
  prize('frame-gold', 'frame', 'gold', 'epic'),
  prize('frame-week', 'frame', 'week', 'legendary'),
  // A line under the team's name, from a closed list (the words are in the dictionary).
  prize('title-braker', 'title', '', 'common'),
  prize('title-rocket', 'title', '', 'common'),
  prize('title-corners', 'title', '', 'rare'),
  prize('title-night', 'title', '', 'rare'),
  prize('title-iron', 'title', '', 'epic'),
  prize('title-legend', 'title', '', 'legendary'),
  // The backdrop of the team's podium place.
  prize('banner-carbon', 'banner', 'carbon', 'common'),
  prize('banner-checker', 'banner', 'checker', 'rare'),
  prize('banner-sunset', 'banner', 'sunset', 'epic'),
  prize('banner-aurora', 'banner', 'aurora', 'legendary'),
  // What the driver says on the radio after a win, from a closed list.
  prize('quote-told', 'quote', '', 'common'),
  prize('quote-easy', 'quote', '', 'rare'),
  prize('quote-champagne', 'quote', '', 'rare'),
  prize('quote-team', 'quote', '', 'epic'),
];

export const ITEM_BY_ID = new Map(SHOP_ITEMS.map((i) => [i.id, i]));

/** What a team has on, as stored: one item id per kind, and the numbers and emblem if bought. */
export interface Equipped {
  color?: string;
  secondary?: string;
  pattern?: string;
  helmet?: string;
  smoke?: string;
  shape?: string;
  wing?: string;
  rim?: string;
  celebration?: string;
  trail?: string;
  flame?: string;
  visor?: string;
  decal?: string;
  engine?: string;
  finish?: string;
  trophy?: string;
  frame?: string;
  title?: string;
  banner?: string;
  quote?: string;
  /** Before season 2: one number for every car of the team. Still read for a car with none of its own. */
  number?: number;
  /** A number per car, by championship entry id. No two cars of a team share one. */
  numbers?: Record<string, number>;
  emblem?: Emblem;
}

/** `shop/{uid}`: everything bought, and what is on the car. */
export interface ShopDoc {
  purchases: string[];
  equipped: Equipped;
  updatedAt: number;
  /**
   * A hand-written list of prizes, honoured only for the dev server's sample
   * teams (`?demo`). Real teams own what their `packs` and `crafted` give,
   * worked out by every browser (`packs.ts`); a list like this proves nothing.
   */
  prizes?: string[];
  /** Packs bought, in order (`packs.ts`). Each one's prizes are worked out from it, not stored. */
  packs?: PackRecord[];
  /** Prizes bought with chips, in order. Each is taken only if the chips were there. */
  crafted?: string[];
}

/** The kinds equipped by item id: one item of each on the car at a time. */
export const SLOT_KINDS = [
  'color', 'secondary', 'pattern', 'helmet', 'smoke', 'shape', 'wing', 'rim', 'celebration',
  'trail', 'flame', 'visor', 'decal', 'engine', 'finish', 'trophy', 'frame', 'title', 'banner', 'quote',
] as const;
export type SlotKind = (typeof SLOT_KINDS)[number];
/** The kinds only packs give. */
export const PRIZE_KINDS: readonly SlotKind[] = ['trail', 'flame', 'visor', 'decal', 'engine', 'finish', 'trophy', 'frame', 'title', 'banner', 'quote'];
const KINDS = SLOT_KINDS;

/** A car number as drawn: a whole number from 1 to 99. */
export function validNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 99;
}

/**
 * A shop document as read: anybody can write their own, so its shape is not
 * trusted either. A `purchases` that is not a list, an `equipped` that is not
 * an object, a field of the wrong type - each reads as empty rather than
 * throwing somewhere in the middle of drawing a grid.
 */
export function normalizeShop(raw: unknown): ShopDoc {
  const d = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const purchases = Array.isArray(d.purchases) ? d.purchases.filter((p): p is string => typeof p === 'string') : [];
  const src = d.equipped && typeof d.equipped === 'object' && !Array.isArray(d.equipped) ? (d.equipped as Record<string, unknown>) : {};
  const equipped: Equipped = {};
  for (const kind of KINDS) {
    const id = src[kind];
    if (typeof id === 'string') equipped[kind] = id;
  }
  if (typeof src.number === 'number' && Number.isFinite(src.number)) equipped.number = src.number;
  if (src.numbers && typeof src.numbers === 'object' && !Array.isArray(src.numbers)) {
    const numbers: Record<string, number> = {};
    const taken = new Set<number>();
    for (const [id, n] of Object.entries(src.numbers as Record<string, unknown>)) {
      // A forged map with one number on several cars keeps it on the first only.
      if (!validNumber(n) || taken.has(n)) continue;
      taken.add(n);
      numbers[id] = n;
    }
    if (Object.keys(numbers).length) equipped.numbers = numbers;
  }
  const emblem = normalizeEmblem(src.emblem);
  if (emblem) equipped.emblem = emblem;
  const prizes = Array.isArray(d.prizes) ? d.prizes.filter((p): p is string => typeof p === 'string' && !!ITEM_BY_ID.get(p)?.pack) : [];
  const packs = normalizePacks(d.packs);
  const crafted = Array.isArray(d.crafted) ? d.crafted.filter((p): p is string => typeof p === 'string' && !!ITEM_BY_ID.get(p)?.pack) : [];
  return {
    purchases,
    equipped,
    updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : 0,
    ...(prizes.length ? { prizes } : {}),
    ...(packs.length ? { packs } : {}),
    ...(crafted.length ? { crafted } : {}),
  };
}

export function spent(purchases: string[]): number {
  return [...new Set(purchases)].reduce((s, id) => s + (ITEM_BY_ID.get(id)?.price ?? 0), 0);
}

/** Every coin a team has spent: paint in the shop and packs (`packs.ts`). What other browsers count too. */
export function spentAll(doc: ShopDoc): number {
  return spent(doc.purchases) + packSpent(doc.packs ?? []);
}

/**
 * The look a team's car may actually wear, or null for "draw the default".
 *
 * Checked by every browser that draws the car: every equipped item must be
 * one the team bought, and the purchases must not cost more than the team
 * has earned. If either fails, the whole look is ignored - not just the bad
 * item - because a forged purchase list says nothing trustworthy about any of it.
 */
export function validLook(
  raw: unknown,
  earned: number,
  opts: PrizeOpts = {},
): Paint | null {
  if (!raw) return null;
  const doc = normalizeShop(raw);
  const owned = new Set(doc.purchases);
  const won = new Set(ownedPrizes(doc, opts));
  if (spentAll(doc) > earned) return null;
  const e = doc.equipped;
  for (const kind of KINDS) {
    const id = e[kind];
    if (!id) continue;
    const it = ITEM_BY_ID.get(id);
    if (it && it.kind === kind && it.price > 0 && !owned.has(id)) return null;
    // A prize the team never won makes the look forged.
    if (it?.pack && !won.has(id)) return null;
  }
  if ((e.number !== undefined || e.numbers) && !owned.has('number')) return null;
  if (e.emblem && !owned.has('emblem')) return null;
  return paintOf(e);
}

export interface PrizeOpts {
  /** Honour the hand-written `prizes` list: only the dev server's sample teams (`?demo`). */
  packs?: boolean;
  /**
   * The prizes the team's packs and chips gave, worked out from its pack
   * records and the race cards (`teamPrizes` in `packs.ts`). The only way a
   * real team owns a prize: a list the team writes itself proves nothing.
   */
  won?: Iterable<string>;
}

/** The prizes in a team's locker: what its packs gave, and on the dev server the sample teams' own list. */
export function ownedPrizes(doc: ShopDoc, opts: PrizeOpts = {}): string[] {
  const out = new Set(opts.won ?? []);
  if (opts.packs) for (const id of doc.prizes ?? []) out.add(id);
  return [...out];
}

/**
 * The shop items that are what a team's car wears anyway: its colour, second
 * colour and pattern come from its name (`livery.ts`), and when the shop sells
 * the very same paint, that item is the team's already. It is shown as owned
 * and never sold to it, and putting it on is going back to the default - so
 * nobody pays for blue on a car that is blue.
 */
export function defaultItems(team: string): Partial<Record<SlotKind, string>> {
  const look = teamLook(team, '');
  const want: Partial<Record<SlotKind, string | undefined>> = {
    color: teamColor(team),
    secondary: look.secondary,
    pattern: look.pattern,
    shape: 'classic',
  };
  const out: Partial<Record<SlotKind, string>> = {};
  for (const [kind, value] of Object.entries(want) as Array<[SlotKind, string | undefined]>) {
    if (!value) continue;
    const it = SHOP_ITEMS.find((i) => i.kind === kind && !i.pack && i.value.toLowerCase() === value.toLowerCase());
    if (it) out[kind] = it.id;
  }
  return out;
}

/** A team's paint: the look its cars share, plus each car's own number and the team's emblem. */
export interface Paint {
  look: CarLook;
  color?: string;
  /** Per-car numbers by entry id, over `look.number`. */
  numbers?: Record<string, number>;
  emblem?: Emblem;
}

/** The emblem the builder opens on: the one on, else the default. */
export function emblemOf(e: Equipped): Emblem {
  return e.emblem ?? DEFAULT_EMBLEM;
}

/**
 * What a set of equipped items looks like, without asking whether it was paid
 * for: the shop's try-on uses this directly, `validLook` only after checking.
 */
export function paintOf(e: Equipped): Paint {
  const pick = (id: string | undefined, kind: ItemKind) => {
    const it = id ? ITEM_BY_ID.get(id) : undefined;
    return it && it.kind === kind ? it : undefined;
  };
  const c = pick(e.color, 'color');
  const secondary = pick(e.secondary, 'secondary');
  const pattern = pick(e.pattern, 'pattern');
  const helmet = pick(e.helmet, 'helmet');
  const smoke = pick(e.smoke, 'smoke');
  const shape = pick(e.shape, 'shape');
  const wingItem = pick(e.wing, 'wing');
  const rimItem = pick(e.rim, 'rim');
  const party = pick(e.celebration, 'celebration');
  const prizes: Partial<CarLook> = {};
  const trail = pick(e.trail, 'trail');
  if (trail) prizes.trail = trail.value;
  const flame = pick(e.flame, 'flame');
  if (flame) prizes.flame = flame.value;
  const visor = pick(e.visor, 'visor');
  if (visor) prizes.visor = visor.value as CarLook['visor'];
  const decal = pick(e.decal, 'decal');
  if (decal) prizes.decal = decal.value as CarLook['decal'];
  const engine = pick(e.engine, 'engine');
  if (engine) prizes.engine = engine.value as CarLook['engine'];
  const finish = pick(e.finish, 'finish');
  if (finish) prizes.finish = finish.value as CarLook['finish'];
  const trophy = pick(e.trophy, 'trophy');
  if (trophy) prizes.trophy = trophy.value as CarLook['trophy'];
  const frame = pick(e.frame, 'frame');
  if (frame) prizes.frame = frame.value as CarLook['frame'];
  const banner = pick(e.banner, 'banner');
  if (banner) prizes.banner = banner.value as CarLook['banner'];
  // A title and a quote travel as item ids: their words are read in the viewer's language.
  if (pick(e.title, 'title')) prizes.title = e.title;
  if (pick(e.quote, 'quote')) prizes.quote = e.quote;
  const n = e.number;
  return {
    color: c?.value,
    ...(e.numbers ? { numbers: e.numbers } : {}),
    ...(e.emblem ? { emblem: e.emblem } : {}),
    look: {
      ...(secondary ? { secondary: secondary.value } : {}),
      ...(pattern ? { pattern: pattern.value as CarLook['pattern'] } : {}),
      ...(helmet ? { helmet: helmet.value } : {}),
      ...(smoke ? { smoke: smoke.value } : {}),
      ...(shape ? { shape: shape.value as CarLook['shape'] } : {}),
      ...(wingItem ? { wing: wingItem.value } : {}),
      ...(rimItem ? { rim: rimItem.value } : {}),
      ...(party ? { celebration: party.value as CelebrationKind } : {}),
      ...prizes,
      ...(e.emblem ? { emblem: e.emblem } : {}),
      ...(validNumber(n) ? { number: n } : {}),
    },
  };
}
