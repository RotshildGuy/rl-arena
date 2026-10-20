import type { CarLook } from '../games/racing/render';

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

const color = (id: string, label: string, value: string, price = 120): ShopItem => ({ id, kind: 'color', label, price, value });
/** The second colour: the stripe, the rear half of a two-tone, and the wings. */
const second = (id: string, label: string, value: string, price = 60): ShopItem => ({
  id,
  kind: 'secondary',
  label,
  price,
  value,
});

export const SHOP_ITEMS: ShopItem[] = [
  color('color-scarlet', 'ארגמן', '#ff2e4d'),
  color('color-crimson', 'בורדו', '#b3122e'),
  color('color-orange', 'כתום מרוץ', '#ff7a1a'),
  color('color-sky', 'תכלת', '#38bdf8'),
  color('color-navy', 'כחול לילה', '#2346c8'),
  color('color-teal', 'טורקיז', '#14b8a6'),
  color('color-pink', 'ורוד', '#ff5fa2'),
  color('color-silver', 'כסף', '#c8d0de', 160),
  color('color-graphite', 'גרפיט', '#3a404f', 160),
  color('color-white', 'לבן', '#f4f6fb', 160),
  second('second-white', 'לבן', '#f4f6fb'),
  second('second-black', 'שחור', '#14161d'),
  second('second-scarlet', 'ארגמן', '#ff2e4d'),
  second('second-orange', 'כתום', '#ff7a1a'),
  second('second-sky', 'תכלת', '#38bdf8'),
  second('second-navy', 'כחול לילה', '#2346c8'),
  second('second-teal', 'טורקיז', '#14b8a6'),
  second('second-pink', 'ורוד', '#ff5fa2'),
  second('second-silver', 'כסף', '#c8d0de'),
  { id: 'pattern-stripe', kind: 'pattern', label: 'פס מרכזי', price: 80, value: 'stripe' },
  { id: 'pattern-twotone', kind: 'pattern', label: 'שני גוונים', price: 80, value: 'twotone' },
  { id: 'pattern-solid', kind: 'pattern', label: 'חלק', price: 0, value: 'solid' },
  { id: 'number', kind: 'number', label: 'מספר לבחירה', price: 60, value: '' },
  { id: 'helmet-gold', kind: 'helmet', label: 'קסדה מוזהבת', price: 50, value: '#e6b422' },
  { id: 'helmet-black', kind: 'helmet', label: 'קסדה שחורה', price: 40, value: '#14161d' },
  { id: 'helmet-red', kind: 'helmet', label: 'קסדה אדומה', price: 40, value: '#ff2e4d' },
  { id: 'smoke-blue', kind: 'smoke', label: 'עשן כחול בדריפט', price: 70, value: 'rgba(80, 150, 255, 0.28)' },
  { id: 'smoke-red', kind: 'smoke', label: 'עשן אדום בדריפט', price: 70, value: 'rgba(255, 70, 90, 0.26)' },
  { id: 'smoke-white', kind: 'smoke', label: 'עשן לבן סמיך', price: 50, value: 'rgba(235, 240, 250, 0.32)' },
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
export function validLook(doc: ShopDoc | null | undefined, earned: number): { look: CarLook; color?: string } | null {
  if (!doc) return null;
  const owned = new Set(doc.purchases);
  if (spent(doc.purchases) > earned) return null;
  const e = doc.equipped;
  for (const kind of ['color', 'secondary', 'pattern', 'helmet', 'smoke'] as const) {
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
