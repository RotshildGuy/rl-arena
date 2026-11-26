/**
 * Are the betting odds honest? Race a long run of days with the dev demo's
 * field (`src/dev/demo.ts`: house weights, varied setups), then ask how well
 * the rating model would have priced each one before it ran.
 *
 *   npx tsx scripts/oddsCheck.ts [rounds]
 *
 * For each race the model's chance for the car that actually won is scored
 * (log loss: lower is better), next to what a coin-flip over the field would
 * score. A model that is too sure of its favourite pays the price here. The
 * table at the end compares the model's chance per driver with how often that
 * driver really won.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildRaceCard } from '../src/core/champ/card';
import { runRaceDay } from '../src/core/champ/sim';
import { HOUSE_DRIVERS } from '../src/core/champ/house';
import { SETUP_ROUND } from '../src/core/champ/schedule';
import { raceOdds, seasonOdds } from '../src/core/champ/bets';
import { ratingsBefore } from '../src/core/champ/ratings';
import { seasonNumber, seasonRange } from '../src/core/champ/schedule';
import { buildStandings } from '../src/core/champ/points';
import type { ArenaEntry, RaceCard, RaceResult } from '../src/core/champ/types';

const ROUNDS = Number(process.argv[2] ?? 64);
const FIELD: Array<[driver: string, uid: string, house: number, setup?: string]> = [
  ['Swift Falcon', 'local', 3, 'downforce'],
  ['Calm Otter', 'local', 1, 'lowdrag'],
  ['Bold Comet', 'demo-a', 3, 'lowdrag'],
  ['Quiet Harbor', 'demo-a', 2],
  ['Rapid Ember', 'demo-b', 2, 'downforce'],
  ['Steady Pine', 'demo-b', 1, 'downforce'],
  ['Gentle Tide', 'demo-c', 1],
  ['Bright Reef', 'demo-c', 0, 'lowdrag'],
  ['Lucky Kite', 'demo-d', 0],
  ['Merry Lark', 'demo-e', 2],
];

const houseWeights = HOUSE_DRIVERS.map((h) => (JSON.parse(readFileSync(`public/house/${h.id}.json`, 'utf8')) as { weightsB64: string }).weightsB64);
const entries: ArenaEntry[] = FIELD.map(([driver, uid, house, setup], i) => ({
  ...HOUSE_DRIVERS[house],
  id: `d${i}`,
  uid,
  team: uid,
  driver,
  tag: driver.slice(0, 3).toUpperCase(),
  createdAt: 0,
  updatedAt: 0,
  ...(setup ? { setup } : {}),
}));
const weights = new Map(entries.map((e, i) => [e.id, houseWeights[FIELD[i][2]]]));

const first = SETUP_ROUND;
// Racing takes about a second a day, so the days are kept between runs.
const CACHE = `node_modules/.cache/oddsCheck-${ROUNDS}.json`;
let cards: RaceCard[] = [];
let results = new Map<string, RaceResult>();
if (existsSync(CACHE)) {
  const kept = JSON.parse(readFileSync(CACHE, 'utf8')) as { cards: RaceCard[]; results: [string, RaceResult][] };
  cards = kept.cards;
  results = new Map(kept.results);
} else {
  for (let r = first; r < first + ROUNDS; r++) {
    const card = buildRaceCard(r, entries, weights);
    cards.push(card);
    results.set(card.id, runRaceDay(card, weights));
  }
  mkdirSync('node_modules/.cache', { recursive: true });
  writeFileSync(CACHE, JSON.stringify({ cards, results: [...results] }));
}

if (process.argv.includes('--tune')) {
  // Log loss of the winner, for each rating speed and sharpness.
  const winner = (c: RaceCard) => results.get(c.id)!.places.find((p) => p.position === 1)!.entryId;
  for (const k of [20, 40, 80, 120, 160, 240]) {
    const row: string[] = [];
    for (const a of [1, 1.5, 2, 2.5, 3, 4]) {
      let loss = 0;
      for (const card of cards.slice(8)) {
        const rt = ratingsBefore(cards, results, card.round, k, 0);
        const s = card.entries.map((e) => 10 ** ((a * (rt.drivers.get(e.id) ?? 1500)) / 400));
        const total = s.reduce((x, y) => x + y, 0);
        loss -= Math.log(s[card.entries.findIndex((e) => e.id === winner(card))] / total);
      }
      row.push(`a=${a}: ${(loss / (cards.length - 8)).toFixed(3)}`);
    }
    console.log(`K=${String(k).padEnd(4)} ${row.join('  ')}`);
  }
  for (const stages of [1, 3, 10]) {
    for (const eta of [20, 40, 80, 160]) {
      const row: string[] = [];
      for (const a of [1, 1.5, 2]) {
        let loss = 0;
        for (const card of cards.slice(8)) {
          const rt = ratingsBefore(cards, results, card.round, eta, stages);
          const s = card.entries.map((e) => 10 ** ((a * (rt.drivers.get(e.id) ?? 1500)) / 400));
          const total = s.reduce((x, y) => x + y, 0);
          loss -= Math.log(s[card.entries.findIndex((e) => e.id === winner(card))] / total);
        }
        row.push(`a=${a}: ${(loss / (cards.length - 8)).toFixed(3)}`);
      }
      console.log(`PL stages=${String(stages).padEnd(3)} eta=${String(eta).padEnd(4)} ${row.join('  ')}`);
    }
  }
  // Title odds (on the full-order Elo, SEASON_RATING_K): log loss of the eventual champion, before every round of every whole season.
  for (const sd of [0, 40, 80, 120, 160, 240]) {
    let loss = 0;
    let count = 0;
    for (let n = seasonNumber(first) + 1; ; n++) {
      const { first: f, last } = seasonRange(n);
      if (last >= first + ROUNDS) break;
      const champ = buildStandings({ cards: cards.filter((c) => c.round >= f && c.round <= last), results }).drivers[0];
      for (let r = f; r <= last; r++) {
        const o = seasonOdds('driver', r, cards, results, [], sd).find((x) => x.id === champ.entryId);
        loss -= Math.log(Math.max(1e-3, o?.p ?? 0));
        count++;
      }
    }
    console.log(`title, form sd ${String(sd).padEnd(4)} log loss ${(loss / count).toFixed(3)}`);
  }
  process.exit(0);
}

const winnerOf = (c: RaceCard) => results.get(c.id)!.places.find((p) => p.position === 1)!.entryId;
let logLoss = 0;
let flat = 0;
let n = 0;
const predicted = new Map<string, number>();
const won = new Map<string, number>();
for (const card of cards.slice(8)) {
  const odds = raceOdds('driver', card.entries, ratingsBefore(cards, results, card.round));
  const w = winnerOf(card);
  const p = odds.find((o) => o.id === w)!.p;
  logLoss -= Math.log(p);
  flat -= Math.log(1 / card.entries.length);
  n++;
  for (const o of odds) predicted.set(o.id, (predicted.get(o.id) ?? 0) + o.p);
  won.set(w, (won.get(w) ?? 0) + 1);
}
console.log(`races scored: ${n}`);
console.log(`log loss, model: ${(logLoss / n).toFixed(3)}   coin flip: ${(flat / n).toFixed(3)}   (lower is better)`);
console.log('\ndriver          expected wins   actual wins');
for (const e of entries) {
  console.log(`${e.driver.padEnd(15)} ${(predicted.get(e.id) ?? 0).toFixed(1).padStart(13)} ${String(won.get(e.id) ?? 0).padStart(13)}`);
}

// Season titles: the model's chance for the eventual champion, per round of the season.
console.log('\nseason   champion        title chance before round 1..8');
for (let s = seasonNumber(first) + 1; s <= seasonNumber(first + ROUNDS - 1); s++) {
  const { first: f, last } = seasonRange(s);
  if (last >= first + ROUNDS) break;
  const held = cards.filter((c) => c.round >= f && c.round <= last);
  const champ = buildStandings({ cards: held, results }).drivers[0];
  const chances: string[] = [];
  for (let r = f; r <= last; r++) {
    const o = seasonOdds('driver', r, cards, results).find((x) => x.id === champ.entryId);
    chances.push(o ? `${Math.round(o.p * 100)}%`.padStart(5) : '    -');
  }
  console.log(`${String(s).padEnd(8)} ${champ.driver.padEnd(15)} ${chances.join(' ')}`);
}
