import { HOUSE_DRIVERS, houseWeightsUrl } from '../core/champ/house';
import { earnedCoins } from '../core/champ/coins';
import { ITEM_BY_ID, type Equipped, type ShopDoc } from '../core/champ/shop';
import { DEMO_SHOP_KEY } from '../storage/shop';
import { startsAtForRound, DAY_MS } from '../core/champ/schedule';
import { settledResults } from '../core/champ/timing';
import type { Emblem } from '../core/champ/emblem';
import type { ArenaEntry } from '../core/champ/types';
import { getArena } from '../storage/arena';
import { syncChampionship } from '../ui/champSync';

/**
 * Sample data for the dev server, opened with `?demo` (and `?demo=reset` to
 * start it again). Development builds only: `main.tsx` imports this behind
 * `import.meta.env.DEV`, so a production bundle never contains it.
 *
 * Five teams besides this browser's own, ten cars, driven by the house
 * weights so they actually lap. The local championship races every round
 * since the season opened, and then each team buys what it can afford from
 * a wish list - the same `validLook` check as for real decides what is worn,
 * so the paint is honest and the tables, broadcast and shop show the season 2
 * customisation on real results.
 */

const SEEDED_KEY = 'rl-arena-demo-seeded';
const SHOP_KEY = 'rl-arena-shop';

interface DemoTeam {
  uid: string;
  team: string;
  drivers: Array<[driver: string, tag: string, house: number]>;
  /** In order of preference: bought while the coins last. */
  wishes: string[];
  equip: Partial<Equipped>;
  emblem?: Emblem;
  numbers?: number[];
}

const TEAMS: DemoTeam[] = [
  {
    uid: 'local',
    team: 'Test Team',
    drivers: [['Swift Falcon', 'SWF', 3], ['Calm Otter', 'CLM', 1]],
    wishes: ['emblem', 'number', 'shape-wedge', 'rim-gold', 'color-navy', 'pattern-chevron', 'second-white'],
    equip: { color: 'color-navy', shape: 'shape-wedge', rim: 'rim-gold', pattern: 'pattern-chevron', secondary: 'second-white' },
    emblem: { shape: 'shield', symbol: 'bolt', fg: '#f4f6fb', bg: '#ff2e4d' },
    numbers: [7, 44],
  },
  {
    uid: 'demo-a',
    team: 'הברקים הכחולים',
    drivers: [['Bold Comet', 'BLD', 3], ['Quiet Harbor', 'QHR', 2]],
    wishes: ['shape-arrow', 'number', 'emblem', 'wing-navy', 'color-sky'],
    equip: { color: 'color-sky', wing: 'wing-navy', shape: 'shape-arrow' },
    emblem: { shape: 'hexagon', symbol: 'star', fg: '#2346c8', bg: '#f4f6fb' },
    numbers: [1, 12],
  },
  {
    uid: 'demo-b',
    team: 'Scarlet Works',
    drivers: [['Rapid Ember', 'RPE', 2], ['Steady Pine', 'STP', 1]],
    wishes: ['shape-bulldog', 'pattern-fade', 'second-black', 'emblem', 'color-scarlet'],
    equip: { color: 'color-scarlet', pattern: 'pattern-fade', secondary: 'second-black', shape: 'shape-bulldog' },
    emblem: { shape: 'circle', symbol: 'flame', fg: '#ff7a1a', bg: '#14161d' },
  },
  {
    uid: 'demo-c',
    team: 'צוות החוף',
    drivers: [['Gentle Tide', 'GTD', 1], ['Bright Reef', 'BRF', 0]],
    wishes: ['number', 'color-teal', 'rim-silver', 'pattern-centerline', 'second-white'],
    equip: { color: 'color-teal', rim: 'rim-silver', pattern: 'pattern-centerline', secondary: 'second-white' },
    numbers: [27, 72],
  },
  {
    uid: 'demo-d',
    team: 'Orange Line',
    drivers: [['Lucky Kite', 'LKT', 0]],
    wishes: ['color-orange', 'emblem'],
    equip: { color: 'color-orange' },
    emblem: { shape: 'diamond', symbol: 'chequer', fg: '#14161d', bg: '#f4f6fb' },
  },
  {
    uid: 'demo-e',
    team: 'Pink Garage',
    drivers: [['Merry Lark', 'MRL', 2]],
    wishes: ['color-pink', 'helmet-black', 'smoke-white'],
    equip: { color: 'color-pink', helmet: 'helmet-black', smoke: 'smoke-white' },
  },
];

async function houseWeights(): Promise<string[]> {
  return Promise.all(
    HOUSE_DRIVERS.map(async (h) => ((await (await fetch(houseWeightsUrl(h.id))).json()) as { weightsB64: string }).weightsB64),
  );
}

/** The local championship and its cache share one database; nothing has it open yet. */
async function wipeLocalChampionship(): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('rl-arena-champ');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

/** Seed once per browser (or again on `?demo=reset`); afterwards the app runs on what is there. */
export async function seedDemo(): Promise<void> {
  const mode = new URLSearchParams(location.search).get('demo');
  if (mode !== 'reset' && localStorage.getItem(SEEDED_KEY)) return;
  await wipeLocalChampionship();

  const weights = await houseWeights();
  const arena = await getArena();
  // Entered before the first lights, so every round of the season so far has them.
  const createdAt = startsAtForRound(1) - DAY_MS;
  let n = 0;
  for (const t of TEAMS) {
    for (const [driver, tag, house] of t.drivers) {
      const base = HOUSE_DRIVERS[house];
      const entry: ArenaEntry = {
        ...base,
        id: `demo-${++n}`,
        uid: t.uid,
        team: t.team,
        driver,
        tag,
        createdAt: createdAt + n,
        updatedAt: createdAt + n,
        modelId: `demo-model-${n}`,
      };
      await arena.putEntry(entry, weights[house]);
    }
  }

  localStorage.setItem('rl-arena.competitor', TEAMS[0].team);
  // The guide has nothing to teach on a season that is already running.
  localStorage.setItem(
    'rl-arena.coach.dismissed',
    JSON.stringify(['name', 'garage', 'create', 'setup', 'save', 'enter', 'unregistered']),
  );

  // Race the season so far, then spend what each team earned.
  const state = await syncChampionship();
  const now = Date.now();
  const settled = settledResults(state.cards, state.results, now);
  const shops: Record<string, ShopDoc> = {};
  for (const t of TEAMS) {
    let coins = earnedCoins(t.uid, state.cards, settled, now).total;
    const purchases: string[] = [];
    for (const id of t.wishes) {
      const price = ITEM_BY_ID.get(id)?.price ?? Infinity;
      if (price > coins) continue;
      coins -= price;
      purchases.push(id);
    }
    const owned = new Set(purchases);
    const equipped: Equipped = {};
    for (const [kind, id] of Object.entries(t.equip) as Array<[keyof Equipped, string]>) {
      if (owned.has(id)) (equipped as Record<string, unknown>)[kind] = id;
    }
    if (t.emblem && owned.has('emblem')) equipped.emblem = t.emblem;
    if (t.numbers && owned.has('number')) {
      const cars = state.entries.filter((e) => e.uid === t.uid).sort((a, b) => a.createdAt - b.createdAt);
      equipped.numbers = Object.fromEntries(cars.map((c, i) => [c.id, t.numbers![i]]).filter(([, v]) => v));
    }
    shops[t.uid] = { purchases, equipped, updatedAt: now };
  }
  localStorage.setItem(SHOP_KEY, JSON.stringify(shops.local));
  localStorage.setItem(DEMO_SHOP_KEY, JSON.stringify(shops));
  localStorage.setItem(SEEDED_KEY, String(now));
}
