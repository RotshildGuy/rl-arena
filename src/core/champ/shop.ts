import type { CarLook } from '../games/racing/render';
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
export type ItemKind = 'color' | 'secondary' | 'pattern' | 'number' | 'helmet' | 'smoke';

export interface ShopItem {
  id: string;
  kind: ItemKind;
  label: string;
  price: number;
  /** The colour, pattern name or, for `number`, empty (the number is chosen). */
  value: string;
}

/** An item whose label is read from the dictionary by its id. */
const item = (base: Omit<ShopItem, 'label'>): ShopItem => translated(base, () => ({ label: t().shopItems[base.id] ?? base.id }));

const color = (id: string, value: string, price = 120): ShopItem => item({ id, kind: 'color', price, value });
/** The second colour: the stripe, the rear half of a two-tone, and the wings. */
const second = (id: string, value: string, price = 60): ShopItem => item({ id, kind: 'secondary', price, value });

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
  item({ id: 'number', kind: 'number', price: 60, value: '' }),
  item({ id: 'helmet-gold', kind: 'helmet', price: 50, value: '#e6b422' }),
  item({ id: 'helmet-black', kind: 'helmet', price: 40, value: '#14161d' }),
  item({ id: 'helmet-red', kind: 'helmet', price: 40, value: '#ff2e4d' }),
  item({ id: 'smoke-blue', kind: 'smoke', price: 70, value: 'rgba(80, 150, 255, 0.28)' }),
  item({ id: 'smoke-red', kind: 'smoke', price: 70, value: 'rgba(255, 70, 90, 0.26)' }),
  item({ id: 'smoke-white', kind: 'smoke', price: 50, value: 'rgba(235, 240, 250, 0.32)' }),
];

export const ITEM_BY_ID = new Map(SHOP_ITEMS.map((i) => [i.id, i]));

/** What a team has on, as stored: one item id per kind, and the number if bought. */
export interface Equipped {
  color?: string;
  secondary?: string;
  pattern?: string;
  helmet?: string;
  smoke?: string;
  number?: number;
}

/** `shop/{uid}`: everything bought, and what is on the car. */
export interface ShopDoc {
  purchases: string[];
  equipped: Equipped;
  updatedAt: number;
}

const KINDS = ['color', 'secondary', 'pattern', 'helmet', 'smoke'] as const;

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
export function validLook(raw: unknown, earned: number): { look: CarLook; color?: string } | null {
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
  if (e.number !== undefined && !owned.has('number')) return null;
  return paintOf(e);
}

/**
 * What a set of equipped items looks like, without asking whether it was paid
 * for: the shop's try-on uses this directly, `validLook` only after checking.
 */
export function paintOf(e: Equipped): { look: CarLook; color?: string } {
  const pick = (id: string | undefined, kind: ItemKind) => {
    const it = id ? ITEM_BY_ID.get(id) : undefined;
    return it && it.kind === kind ? it : undefined;
  };
  const c = pick(e.color, 'color');
  const secondary = pick(e.secondary, 'secondary');
  const pattern = pick(e.pattern, 'pattern');
  const helmet = pick(e.helmet, 'helmet');
  const smoke = pick(e.smoke, 'smoke');
  const n = e.number;
  return {
    color: c?.value,
    look: {
      ...(secondary ? { secondary: secondary.value } : {}),
      ...(pattern ? { pattern: pattern.value as CarLook['pattern'] } : {}),
      ...(helmet ? { helmet: helmet.value } : {}),
      ...(smoke ? { smoke: smoke.value } : {}),
      ...(n !== undefined && Number.isInteger(n) && n >= 1 && n <= 99 ? { number: n } : {}),
    },
  };
}
