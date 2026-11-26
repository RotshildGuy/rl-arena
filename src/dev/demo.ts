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
 * customisation on real results. Season 4: every team stands on the podium
 * with a celebration of its own.
 */

const SEEDED_KEY = 'rl-arena-demo-seeded';
const SHOP_KEY = 'rl-arena-shop';

interface DemoTeam {
  uid: string;
  team: string;
  drivers: Array<[driver: string, tag: string, house: number, setup?: string]>;
  /** In order of preference: bought while the coins last. */
  wishes: string[];
  equip: Partial<Equipped>;
  emblem?: Emblem;
  numbers?: number[];
}

// Every team also wears pack prizes (season 6), which only the dev server honours
// (`teamLooks.ts`), so the broadcast, tower and podium can be seen with them.
const TEAMS: DemoTeam[] = [
  {
    uid: 'local',
    team: 'Test Team',
    drivers: [['Swift Falcon', 'SWF', 3, 'downforce'], ['Calm Otter', 'CLM', 1, 'lowdrag']],
    // Short of everything it could buy, so it has coins left to bet with (season 5).
    wishes: ['celebrate-fireworks', 'emblem', 'number', 'color-navy', 'trail-gold', 'finish-stars', 'trophy-diamond', 'frame-week', 'title-legend', 'banner-aurora', 'quote-champagne', 'engine-v10', 'visor-crown'],
    equip: { celebration: 'celebrate-fireworks', color: 'color-navy', trail: 'trail-gold', finish: 'finish-stars', trophy: 'trophy-diamond', frame: 'frame-week', title: 'title-legend', banner: 'banner-aurora', quote: 'quote-champagne', engine: 'engine-v10', visor: 'visor-crown' },
    emblem: { shape: 'shield', symbol: 'bolt', fg: '#f4f6fb', bg: '#ff2e4d' },
    numbers: [7, 44],
  },
  {
    uid: 'demo-a',
    team: 'הברקים הכחולים',
    drivers: [['Bold Comet', 'BLD', 3, 'lowdrag'], ['Quiet Harbor', 'QHR', 2]],
    wishes: ['celebrate-confetti', 'shape-arrow', 'number', 'emblem', 'wing-navy', 'color-sky', 'trail-rainbow', 'flame-blue', 'decal-bolt', 'engine-electric', 'trophy-laurel', 'frame-gold', 'title-rocket', 'banner-checker', 'quote-told'],
    equip: { celebration: 'celebrate-confetti', color: 'color-sky', wing: 'wing-navy', shape: 'shape-arrow', trail: 'trail-rainbow', flame: 'flame-blue', decal: 'decal-bolt', engine: 'engine-electric', trophy: 'trophy-laurel', frame: 'frame-gold', title: 'title-rocket', banner: 'banner-checker', quote: 'quote-told' },
    emblem: { shape: 'hexagon', symbol: 'star', fg: '#2346c8', bg: '#f4f6fb' },
    numbers: [1, 12],
  },
  {
    uid: 'demo-b',
    team: 'Scarlet Works',
    drivers: [['Rapid Ember', 'RPE', 2, 'downforce'], ['Steady Pine', 'STP', 1, 'downforce']],
    wishes: ['celebrate-champagne', 'shape-bulldog', 'pattern-fade', 'second-black', 'emblem', 'color-scarlet', 'flame-orange', 'visor-flames', 'decal-flame', 'engine-v8', 'finish-sparks', 'trophy-crown', 'frame-silver', 'title-corners', 'banner-sunset', 'quote-easy'],
    equip: { celebration: 'celebrate-champagne', color: 'color-scarlet', pattern: 'pattern-fade', secondary: 'second-black', shape: 'shape-bulldog', flame: 'flame-orange', visor: 'visor-flames', decal: 'decal-flame', engine: 'engine-v8', finish: 'finish-sparks', trophy: 'trophy-crown', frame: 'frame-silver', title: 'title-corners', banner: 'banner-sunset', quote: 'quote-easy' },
    emblem: { shape: 'circle', symbol: 'flame', fg: '#ff7a1a', bg: '#14161d' },
  },
  {
    uid: 'demo-c',
    team: 'צוות החוף',
    drivers: [['Gentle Tide', 'GTD', 1], ['Bright Reef', 'BRF', 0, 'lowdrag']],
    wishes: ['celebrate-bubbles', 'number', 'color-teal', 'rim-silver', 'pattern-centerline', 'second-white', 'trail-sky', 'visor-stripe', 'decal-star', 'engine-turbo', 'finish-shockwave', 'trophy-wheel', 'frame-bronze', 'banner-carbon', 'quote-team'],
    equip: { celebration: 'celebrate-bubbles', color: 'color-teal', rim: 'rim-silver', pattern: 'pattern-centerline', secondary: 'second-white', trail: 'trail-sky', visor: 'visor-stripe', decal: 'decal-star', engine: 'engine-turbo', finish: 'finish-shockwave', trophy: 'trophy-wheel', frame: 'frame-bronze', banner: 'banner-carbon', quote: 'quote-team' },
    numbers: [27, 72],
  },
  {
    uid: 'demo-d',
    team: 'Orange Line',
    drivers: [['Lucky Kite', 'LKT', 0]],
    wishes: ['celebrate-balloons', 'color-orange', 'emblem', 'flame-pink', 'wing-gold', 'rim-chrome', 'decal-crown', 'trophy-star', 'title-iron'],
    equip: { celebration: 'celebrate-balloons', color: 'color-orange', flame: 'flame-pink', wing: 'wing-gold', rim: 'rim-chrome', decal: 'decal-crown', trophy: 'trophy-star', title: 'title-iron' },
    emblem: { shape: 'diamond', symbol: 'chequer', fg: '#14161d', bg: '#f4f6fb' },
  },
  {
    uid: 'demo-e',
    team: 'Pink Garage',
    drivers: [['Merry Lark', 'MRL', 2]],
    wishes: ['celebrate-sparkles', 'color-pink', 'helmet-black', 'smoke-white', 'trail-white', 'visor-checker', 'decal-sun', 'trophy-cup', 'title-night'],
    equip: { celebration: 'celebrate-sparkles', color: 'color-pink', helmet: 'helmet-black', smoke: 'smoke-white', trail: 'trail-white', visor: 'visor-checker', decal: 'decal-sun', trophy: 'trophy-cup', title: 'title-night' },
  },
];

async function houseWeights(): Promise<string[]> {
  return Promise.all(
    HOUSE_DRIVERS.map(async (h) => ((await (await fetch(houseWeightsUrl(h.id))).json()) as { weightsB64: string }).weightsB64),
  );
}

/**
 * Empty the local championship and its cache (they share one database). It is
 * emptied rather than deleted: a delete waits for every other tab of the app
 * to let go of the database, and a tab left open on the dev server kept a
 * reset hanging on the loading screen for good.
 */
async function wipeLocalChampionship(): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('rl-arena-champ', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

const DAYS_KEY = 'rl-arena-demo-days';

/**
 * `?demo&days=3`: the whole app lives three days ahead - for trying out a
 * season that has not started yet (its setups, its bets) on races that have
 * already happened. Remembered by this browser until `days=0`. A changed
 * shift needs `?demo=reset` as well, so the season is raced again up to the
 * new date.
 */
export function shiftDemoClock(): void {
  const param = new URLSearchParams(location.search).get('days');
  if (param !== null) localStorage.setItem(DAYS_KEY, String(Math.max(0, Math.min(60, Number(param) || 0))));
  const days = Number(localStorage.getItem(DAYS_KEY) ?? 0);
  if (!days) return;
  const shift = days * DAY_MS;
  const Real = Date;
  class Shifted extends Real {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(Real.now() + shift);
      else super(...(args as [number]));
    }
    static now(): number {
      return Real.now() + shift;
    }
  }
  (globalThis as { Date: DateConstructor }).Date = Shifted as unknown as DateConstructor;
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
    for (const [driver, tag, house, setup] of t.drivers) {
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
        ...(setup ? { setup } : {}),
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
    // Pack prizes are won, not bought: into the locker, not the purchases.
    const prizes = t.wishes.filter((id) => ITEM_BY_ID.get(id)?.pack);
    shops[t.uid] = { purchases: purchases.filter((id) => !ITEM_BY_ID.get(id)?.pack), equipped, updatedAt: now, ...(prizes.length ? { prizes } : {}) };
  }
  localStorage.setItem(SHOP_KEY, JSON.stringify(shops.local));
  localStorage.setItem(DEMO_SHOP_KEY, JSON.stringify(shops));
  localStorage.setItem(SEEDED_KEY, String(now));
}
