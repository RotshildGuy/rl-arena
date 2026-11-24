import { describe, expect, it } from 'vitest';
import { ITEM_BY_ID, PRIZE_KINDS, RARITIES, SHOP_ITEMS, defaultItems, normalizeShop, ownedPrizes, paintOf, spent, validLook } from './shop';
import { EMBLEM_SHAPES, EMBLEM_SYMBOLS } from './emblem';
import { teamColor } from './livery';
import { he } from '../../i18n/he';
import { en } from '../../i18n/en';

// Pack prizes (season 6): in the catalogue now, owned by nobody until packs open.

const prizes = SHOP_ITEMS.filter((i) => i.pack);

describe('pack prizes', () => {
  it('are many, of every kind, and every one has a rarity', () => {
    expect(prizes.length).toBeGreaterThanOrEqual(50);
    for (const kind of PRIZE_KINDS) expect(prizes.some((p) => p.kind === kind)).toBe(true);
    for (const p of prizes) expect(RARITIES).toContain(p.rarity);
    // Something to chase: each rarity is there, legendary the scarcest.
    const count = (r: string) => prizes.filter((p) => p.rarity === r).length;
    expect(count('legendary')).toBeGreaterThan(0);
    expect(count('legendary')).toBeLessThan(count('rare'));
  });

  it('are never bought: they cost nothing to the books', () => {
    expect(spent(prizes.map((p) => p.id))).toBe(0);
  });

  it('only use ids nobody else has', () => {
    expect(new Set(SHOP_ITEMS.map((i) => i.id)).size).toBe(SHOP_ITEMS.length);
  });

  it('have words in both languages', () => {
    for (const p of prizes) {
      expect(he.shopItems[p.id], p.id).toBeTruthy();
      expect(en.shopItems[p.id], p.id).toBeTruthy();
    }
  });

  it('are made of drawings that exist', () => {
    for (const p of prizes.filter((x) => x.kind === 'decal')) {
      expect(EMBLEM_SYMBOLS[p.value === 'checker' ? 'chequer' : p.value], p.id).toBeTruthy();
    }
    expect(EMBLEM_SHAPES.diamond).toBeTruthy();
  });

  it('make a look void when worn before packs open', () => {
    const doc = { purchases: [], equipped: { trail: 'trail-gold' }, updatedAt: 0, prizes: ['trail-gold'] };
    expect(validLook(doc, 1000)).toBeNull();
    // The dev server's sample teams may wear the ones in their locker.
    expect(validLook(doc, 1000, { packs: true })?.look.trail).toBe(ITEM_BY_ID.get('trail-gold')!.value);
  });

  it('can only be worn from the locker: buying one is not a thing', () => {
    const bought = { purchases: ['trail-gold'], equipped: { trail: 'trail-gold' }, updatedAt: 0 };
    expect(validLook(bought, 1000, { packs: true })).toBeNull();
    expect(ownedPrizes(normalizeShop({ prizes: ['trail-gold', 'color-navy', 7] }), { packs: true })).toEqual(['trail-gold']);
    expect(ownedPrizes(normalizeShop({ prizes: ['trail-gold'] }))).toEqual([]);
  });

  it('a painted wing from a pack is a prize, not a shop wing', () => {
    const doc = { purchases: ['wing-gold'], equipped: { wing: 'wing-gold' }, updatedAt: 0 };
    expect(validLook(doc, 1000)).toBeNull();
  });

  it('reach the look the car is drawn from', () => {
    const look = paintOf({
      trail: 'trail-rainbow',
      flame: 'flame-blue',
      visor: 'visor-flames',
      decal: 'decal-bolt',
      engine: 'engine-v8',
      finish: 'finish-stars',
      trophy: 'trophy-diamond',
      frame: 'frame-week',
      banner: 'banner-aurora',
      title: 'title-legend',
      quote: 'quote-told',
    }).look;
    expect(look).toMatchObject({
      trail: 'rainbow',
      visor: 'flames',
      decal: 'bolt',
      engine: 'v8',
      finish: 'stars',
      trophy: 'diamond',
      frame: 'week',
      banner: 'aurora',
      title: 'title-legend',
      quote: 'quote-told',
    });
    // An id of the wrong kind is ignored, as for every other slot.
    expect(paintOf({ trophy: 'trail-gold' }).look.trophy).toBeUndefined();
  });
});

describe('the default look', () => {
  it('is the shop item a team already wears, when the shop sells it', () => {
    // Every team colour the shop also sells comes out as that item.
    for (const team of ['Alpha', 'Beta', 'Test Team', 'הברקים הכחולים', 'x', 'y', 'z', 'Q']) {
      const d = defaultItems(team);
      if (d.color) expect(ITEM_BY_ID.get(d.color)!.value.toLowerCase()).toBe(teamColor(team).toLowerCase());
      expect(d.shape).toBe('shape-classic');
      expect(['second-white', 'second-black']).toContain(d.secondary);
    }
  });
});
