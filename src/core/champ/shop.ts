import type { CarLook } from '../games/racing/render';
import { DEFAULT_EMBLEM, normalizeEmblem, type Emblem } from './emblem';
import { t, translated } from '../../i18n/dict';

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
  | 'shape' | 'wing' | 'rim' | 'emblem';

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
}

/** The kinds equipped by item id: one item of each on the car at a time. */
export const SLOT_KINDS = ['color', 'secondary', 'pattern', 'helmet', 'smoke', 'shape', 'wing', 'rim'] as const;
export type SlotKind = (typeof SLOT_KINDS)[number];
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
  return { purchases, equipped, updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : 0 };
}

export function spent(purchases: string[]): number {
  return [...new Set(purchases)].reduce((s, id) => s + (ITEM_BY_ID.get(id)?.price ?? 0), 0);
}

/**
 * The look a team's car may actually wear, or null for "draw the default".
 *
 * Checked by every browser that draws the car: every equipped item must be
 * one the team bought, and the purchases must not cost more than the team
 * has earned. If either fails, the whole look is ignored - not just the bad
 * item - because a forged purchase list says nothing trustworthy about any of it.
 */
export function validLook(raw: unknown, earned: number): Paint | null {
  if (!raw) return null;
  const doc = normalizeShop(raw);
  const owned = new Set(doc.purchases);
  if (spent(doc.purchases) > earned) return null;
  const e = doc.equipped;
  for (const kind of KINDS) {
    const id = e[kind];
    if (!id) continue;
    const it = ITEM_BY_ID.get(id);
    if (it && it.kind === kind && it.price > 0 && !owned.has(id)) return null;
  }
  if ((e.number !== undefined || e.numbers) && !owned.has('number')) return null;
  if (e.emblem && !owned.has('emblem')) return null;
  return paintOf(e);
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
      ...(e.emblem ? { emblem: e.emblem } : {}),
      ...(validNumber(n) ? { number: n } : {}),
    },
  };
}
