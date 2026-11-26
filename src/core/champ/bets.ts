import { mulberry32 } from '../rng';
import { buildStandings, FASTEST_LAP_BONUS, POINTS } from './points';
import { MAX_CARS_PER_TEAM } from './card';
import { ratingsBefore, BASE_RATING, type Ratings } from './ratings';
import { raceIdForRound, seasonForRound, seasonNumber, seasonRange, startsAtForRound } from './schedule';
import { seasonCards, seasonComplete } from './seasons';
import type { ArenaEntry, RaceCard, RaceResult } from './types';

/**
 * Betting with coins, on who wins a race day or a season - a driver or a team.
 *
 * A bet is private: it lives under its owner (`users/{uid}/bets`), nobody
 * else can read it, and nobody else ever learns what anybody backed. Only
 * the server, which settles them, reads them all.
 *
 * The odds come from the hidden ratings (`ratings.ts`), with a margin for
 * the house, and they are *starting prices*: a bet placed before the entry
 * list closes is paid at the odds of the field that actually lined up. Until
 * then the screen shows an estimate from the cars entered so far. That makes
 * the odds of every bet a pure function of published data - the race card,
 * the results before it - so the server and every browser settle a bet to the
 * same coin, and the odds cannot be forged by writing them on the bet.
 *
 * Season odds move with the season: they come from simulating the rounds
 * still to run, from the points already scored, so a bet on the leader after
 * six rounds pays little and a bet before the first round pays more.
 */

export type BetKind = 'race' | 'season';
export type BetMarket = 'driver' | 'team';

export interface Bet {
  id: string;
  kind: BetKind;
  market: BetMarket;
  /** An entry id for a driver, an account uid for a team. */
  pick: string;
  stake: number;
  /**
   * The race the bet is on; for a season bet, the next race at the time it
   * was placed - which is how far into the season it was.
   */
  round: number;
  /** `raceIdForRound(round)`: the security rules refuse a bet once this race has started. */
  raceId: string;
  seasonId: string;
  placedAt: number;
}

export const MIN_STAKE = 5;
/** The house's margin, taken off the fair odds. */
const MARGIN = 0.1;
const MIN_ODDS = 1.01;
const MAX_RACE_ODDS = 50;
const MAX_SEASON_ODDS = 100;
/** Simulated seasons behind a season's odds. */
const SEASON_RUNS = 1200;
/** A race day with no result this long after its lights is not coming: its bets are returned. */
const NO_RESULT_VOID_MS = 24 * 60 * 60 * 1000;

export interface Runner {
  /** Entry id or uid, as a bet's `pick`. */
  id: string;
  /** For the screen: a driver's name or a team's. */
  label: string;
  team: string;
  /** Chance of winning, as the model sees it. */
  p: number;
  /** Paid per coin staked, stake included. */
  odds: number;
}

/**
 * The prices odds can take, the way a betting exchange quotes them: fine
 * steps near evens, where a hundredth is a real difference, coarse ones out
 * where nobody cares about 41 against 42. Each band is [up to, step].
 */
const LADDER: ReadonlyArray<readonly [number, number]> = [
  [2, 0.01],
  [3, 0.02],
  [4, 0.05],
  [6, 0.1],
  [10, 0.2],
  [20, 0.5],
  [30, 1],
  [50, 2],
  [100, 5],
];

/** The highest price on the ladder at or below `x` - rounding is always in the house's favour. */
export function onLadder(x: number): number {
  let lo = 1;
  for (const [hi, step] of LADDER) {
    if (x < hi) return Math.round((lo + Math.floor((x - lo) / step + 1e-9) * step) * 100) / 100;
    lo = hi;
  }
  return lo;
}

function priced(p: number, max: number): number {
  const fair = (1 - MARGIN) / Math.max(p, 1e-9);
  return Math.max(MIN_ODDS, Math.min(max, onLadder(fair)));
}

/** The most a driver can still add on one race day: the win and the fastest lap. */
const DAY_MAX_DRIVER = POINTS[0] + FASTEST_LAP_BONUS;
/** The most a team can: a one-two, and the fastest lap. */
const DAY_MAX_TEAM = POINTS.slice(0, MAX_CARS_PER_TEAM).reduce((a, b) => a + b, 0) + FASTEST_LAP_BONUS;

/**
 * Is the title already won, before `round` - is the leader further ahead
 * than anybody could make up, if they won everything left? Then there is no
 * market: a bookmaker takes the champion off the board, it does not offer
 * a price on a certainty. Ties are not counted as won, since the tie-break
 * could still go either way.
 */
export function titleDecided(market: BetMarket, round: number, cards: RaceCard[], settled: Map<string, RaceResult>): boolean {
  const n = seasonNumber(round);
  const held = seasonCards(cards, n).filter((c) => c.round < round && settled.has(c.id));
  if (held.length === 0) return false;
  const table = buildStandings({ cards: held, results: settled });
  const pts = (market === 'driver' ? table.drivers : table.teams).map((x) => x.points).sort((a, b) => b - a);
  const left = Math.max(0, seasonRange(n).last - round + 1);
  return pts[0] - (pts[1] ?? 0) > left * (market === 'driver' ? DAY_MAX_DRIVER : DAY_MAX_TEAM);
}

/**
 * How much a rating gap counts when the odds are worked out. Above 1 the
 * favourite's chance grows faster than a plain Elo gap says - fitted, with
 * `RATING_K`, to who actually won (`npx tsx scripts/oddsCheck.ts --tune`):
 * on plain Elo the leading car won twice as often as its odds said.
 */
export const SHARPNESS = 1.5;
/**
 * Over the rest of a season a car's level is not fixed: teams bring new
 * weights, a setup suits one circuit and not the next. Each simulated season
 * moves every rating by this much (a standard deviation), so the title odds
 * carry that doubt and are not just the race odds compounded. Fitted on the
 * demo field (`oddsCheck.ts`) it came out at 80 - but the demo cars never
 * change, and real teams upload new weights all season, so it is set well
 * above that.
 */
export const SEASON_FORM_SD = 200;
/** Elo speed of the full-order rating behind the title odds (fitted like the rest). */
export const SEASON_RATING_K = 80;

const strength = (r: number) => 10 ** ((SHARPNESS * r) / 400);

/** The runners of a race-day market, favourite first. */
export function raceOdds(market: BetMarket, field: readonly ArenaEntry[], ratings: Ratings): Runner[] {
  if (market === 'driver') {
    const s = field.map((e) => strength(ratings.drivers.get(e.id) ?? BASE_RATING));
    const total = s.reduce((a, b) => a + b, 0) || 1;
    return field
      .map((e, i) => ({ id: e.id, label: e.driver, team: e.team, p: s[i] / total, odds: priced(s[i] / total, MAX_RACE_ODDS) }))
      .sort((a, b) => b.p - a.p);
  }
  const teams = new Map<string, string>();
  for (const e of field) if (!teams.has(e.uid)) teams.set(e.uid, e.team);
  const ids = [...teams.keys()];
  const s = ids.map((uid) => strength(ratings.teams.get(uid) ?? BASE_RATING));
  const total = s.reduce((a, b) => a + b, 0) || 1;
  return ids
    .map((uid, i) => ({ id: uid, label: teams.get(uid)!, team: teams.get(uid)!, p: s[i] / total, odds: priced(s[i] / total, MAX_RACE_ODDS) }))
    .sort((a, b) => b.p - a.p);
}

const seasonCache = new Map<string, Runner[]>();

/**
 * The runners of a season market at round `round` of season: the chance of
 * each driver (or team) being champion, from simulating the rounds from
 * `round` to the last, `SEASON_RUNS` times, on top of the points scored
 * before it. Seeded by the season and round, so it is the same everywhere.
 *
 * The field is every car on the season's race cards up to and including
 * `round` - once that card exists, which is when the odds are final. Before
 * it, `entered` stands in for the cars entered so far.
 */
export function seasonOdds(
  market: BetMarket,
  round: number,
  cards: RaceCard[],
  settled: Map<string, RaceResult>,
  entered: readonly ArenaEntry[] = [],
  formSd = SEASON_FORM_SD,
): Runner[] {
  const n = seasonNumber(round);
  const { last } = seasonRange(n);
  const mine = seasonCards(cards, n).filter((c) => c.round <= round);
  const field = new Map<string, ArenaEntry>();
  for (const c of mine) for (const e of c.entries) field.set(e.id, e);
  if (!mine.some((c) => c.round === round)) for (const e of entered) if (!field.has(e.id)) field.set(e.id, e);
  const done = mine.filter((c) => c.round < round && settled.has(c.id));
  const key = `${market}|${formSd}|${round}|${[...field.keys()].sort().join(',')}|${done.map((c) => c.id).join(',')}`;
  const hit = seasonCache.get(key);
  if (hit) return hit;

  const drivers = [...field.values()];
  // A title is points over the whole order, so the season is simulated on
  // the full-order rating, not on the one tuned to who wins a race.
  const ratings = ratingsBefore(cards, settled, round, SEASON_RATING_K, 0);
  const logS = drivers.map((e) => ((SHARPNESS * (ratings.drivers.get(e.id) ?? BASE_RATING)) / 400) * Math.LN10);
  const form = new Float64Array(drivers.length);
  const base = drivers.map(() => 0);
  const index = new Map(drivers.map((e, i) => [e.id, i]));
  for (const c of done) {
    for (const p of settled.get(c.id)!.places) {
      const i = index.get(p.entryId);
      if (i !== undefined) base[i] += p.points;
    }
  }
  const uids = [...new Set(drivers.map((e) => e.uid))];
  const teamOf = drivers.map((e) => uids.indexOf(e.uid));
  const wins = new Array<number>(market === 'driver' ? drivers.length : uids.length).fill(0);
  const remaining = Math.max(0, last - round + 1);
  const rng = mulberry32((n * 1009 + round * 7919) >>> 0);
  const keys = new Float64Array(drivers.length);
  const order = drivers.map((_, i) => i);

  for (let run = 0; run < SEASON_RUNS && drivers.length > 0; run++) {
    const pts = base.slice();
    // This season's form: a normal draw per car (Box-Muller), in rating points.
    for (let i = 0; i < drivers.length; i++) {
      const g = Math.sqrt(-2 * Math.log(rng() || 1e-12)) * Math.cos(2 * Math.PI * rng());
      form[i] = ((SHARPNESS * g * formSd) / 400) * Math.LN10;
    }
    for (let r = 0; r < remaining; r++) {
      // Plackett-Luce by the Gumbel trick: strength plus noise, sorted.
      for (let i = 0; i < drivers.length; i++) keys[i] = logS[i] + form[i] - Math.log(-Math.log(rng() || 1e-12));
      order.sort((a, b) => keys[b] - keys[a]);
      for (let pos = 0; pos < POINTS.length && pos < order.length; pos++) pts[order[pos]] += POINTS[pos];
    }
    if (market === 'driver') {
      let best = 0;
      for (let i = 1; i < pts.length; i++) if (pts[i] > pts[best]) best = i;
      wins[best]++;
    } else {
      const tp = new Array<number>(uids.length).fill(0);
      pts.forEach((v, i) => (tp[teamOf[i]] += v));
      let best = 0;
      for (let i = 1; i < tp.length; i++) if (tp[i] > tp[best]) best = i;
      wins[best]++;
    }
  }

  const runs = SEASON_RUNS;
  const floor = 0.5 / runs;
  const out: Runner[] =
    market === 'driver'
      ? drivers.map((e, i) => ({ id: e.id, label: e.driver, team: e.team, p: wins[i] / runs, odds: priced(Math.max(floor, wins[i] / runs), MAX_SEASON_ODDS) }))
      : uids.map((uid, i) => {
          const team = drivers.find((e) => e.uid === uid)!.team;
          return { id: uid, label: team, team, p: wins[i] / runs, odds: priced(Math.max(floor, wins[i] / runs), MAX_SEASON_ODDS) };
        });
  // A title pays at least what the next race pays through the first half of
  // the season: it asks for more than one good day. In the second half the
  // floor fades with the rounds left, so a title all but won is not priced
  // like an open race (decided 24.11).
  const raceCard = cards.find((c) => c.round === round);
  const raceField = raceCard ? raceCard.entries : entered;
  if (raceField.length > 1) {
    const share = Math.min(1, remaining / ((last - seasonRange(n).first + 1) / 2));
    const race = new Map(raceOdds(market, raceField, ratingsBefore(cards, settled, round)).map((r) => [r.id, r.odds]));
    for (const r of out) {
      const ro = race.get(r.id);
      if (ro === undefined) continue;
      const floorOdds = onLadder(1 + (ro - 1) * share);
      if (floorOdds > r.odds) r.odds = Math.min(MAX_SEASON_ODDS, floorOdds);
    }
  }
  // By what each pays, as it is shown - the floor can lift a runner past others.
  out.sort((a, b) => a.odds - b.odds || b.p - a.p);
  if (seasonCache.size > 64) seasonCache.clear();
  seasonCache.set(key, out);
  return out;
}

export type BetStatus = 'open' | 'won' | 'lost' | 'void';

export interface Settlement {
  status: BetStatus;
  /** Final odds, once the field is known; null before. */
  odds: number | null;
  /** Coins paid back: stake times odds on a win, the stake on a void, 0 otherwise. */
  payout: number;
  /** Why a bet was void, for the screen. */
  reason?: 'nofield' | 'norace' | 'funds' | 'late' | 'invalid' | 'closed';
}

/** Is this a bet that could have been placed at all? Anything else is void. */
export function validBet(b: Bet): boolean {
  return (
    (b.kind === 'race' || b.kind === 'season') &&
    (b.market === 'driver' || b.market === 'team') &&
    typeof b.pick === 'string' &&
    b.pick.length > 0 &&
    Number.isInteger(b.stake) &&
    b.stake >= MIN_STAKE &&
    Number.isInteger(b.round) &&
    b.round >= 1 &&
    b.raceId === raceIdForRound(b.round) &&
    b.seasonId === seasonForRound(b.round) &&
    typeof b.placedAt === 'number' &&
    // Placed before the lights of the race it is on (or, for a season, of
    // the next race then). The rules check this too, against the server's clock.
    b.placedAt < startsAtForRound(b.round)
  );
}

/** How one bet stands, from the published race days. Pass settled results only. */
export function settleBet(b: Bet, cards: RaceCard[], settled: Map<string, RaceResult>, now: number): Settlement {
  if (!validBet(b)) return { status: 'void', odds: null, payout: b.stake > 0 ? b.stake : 0, reason: 'invalid' };
  const voided = (reason: Settlement['reason']): Settlement => ({ status: 'void', odds: null, payout: b.stake, reason });
  const card = cards.find((c) => c.round === b.round);

  if (b.kind === 'race') {
    if (!card) return now > startsAtForRound(b.round) + 3 * 60 * 60 * 1000 ? voided('norace') : open();
    const runners = raceOdds(b.market, card.entries, ratingsBefore(cards, settled, b.round));
    const runner = runners.find((r) => r.id === b.pick);
    if (!runner) return voided('nofield');
    const result = settled.get(card.id);
    if (!result) return now > card.startsAt + NO_RESULT_VOID_MS ? voided('norace') : { status: 'open', odds: runner.odds, payout: 0 };
    const win = result.places.find((p) => p.position === 1 && p.classified);
    const winner = win && card.entries.find((e) => e.id === win.entryId);
    const won = !!winner && (b.market === 'driver' ? winner.id === b.pick : winner.uid === b.pick);
    return { status: won ? 'won' : 'lost', odds: runner.odds, payout: won ? Math.floor(b.stake * runner.odds) : 0 };
  }

  // A season bet: final odds once the card of its round exists, settled when the season is over.
  const n = seasonNumber(b.round);
  // A bet on a title already won has nothing to win: the screen does not
  // take it, and one written past it gets its coins back.
  if (titleDecided(b.market, b.round, cards, settled)) return voided('closed');
  const final = !!card || now > startsAtForRound(b.round) + 3 * 60 * 60 * 1000;
  if (!final) return open();
  const runners = seasonOdds(b.market, b.round, cards, settled);
  const runner = runners.find((r) => r.id === b.pick);
  if (!runner) return voided('nofield');
  if (!seasonComplete(n, cards, settled, now)) return { status: 'open', odds: runner.odds, payout: 0 };
  const held = seasonCards(cards, n).filter((c) => settled.has(c.id));
  if (held.length === 0) return voided('norace');
  const table = buildStandings({ cards: held, results: settled });
  const uidOf = new Map(held.flatMap((c) => c.entries.map((e) => [e.id, e.uid] as const)));
  const won =
    b.market === 'driver'
      ? !!table.drivers[0]?.entryIds.includes(b.pick)
      : !!table.teams[0] && (table.teams[0].uid === b.pick || table.teams[0].entries.some((id) => uidOf.get(id) === b.pick));
  return { status: won ? 'won' : 'lost', odds: runner.odds, payout: won ? Math.floor(b.stake * runner.odds) : 0 };

  function open(): Settlement {
    return { status: 'open', odds: null, payout: 0 };
  }
}

export interface BetBook {
  /** Every bet with how it stands, newest first. */
  rows: Array<{ bet: Bet; s: Settlement }>;
  /** Coins won back minus coins staked, over every bet - open stakes included. */
  net: number;
  /** The same over finished bets only: what the server publishes for everybody to check against. */
  settledNet: number;
  /** Coins on bets still open. */
  atStake: number;
}

/**
 * A team's bets, in the order they were placed, against what it had to bet
 * with: `budget` is its coins earned minus coins spent in the shop. A bet the
 * team could not afford when it was placed is void - the rules cannot check a
 * balance, so this is where an overdrawn bet is caught.
 */
export function betBook(bets: Bet[], budget: number, cards: RaceCard[], settled: Map<string, RaceResult>, now: number): BetBook {
  const sorted = [...bets].sort((a, b) => a.placedAt - b.placedAt || a.id.localeCompare(b.id));
  let available = budget;
  let net = 0;
  let settledNet = 0;
  let atStake = 0;
  const rows: BetBook['rows'] = [];
  // Coins coming back from a finished bet can only be staked again on a bet
  // placed after the race that decided it.
  const pending: Array<{ from: number; coins: number }> = [];
  for (const bet of sorted) {
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].from <= bet.placedAt) {
        available += pending[i].coins;
        pending.splice(i, 1);
      }
    }
    let s: Settlement;
    if (!Number.isInteger(bet.stake) || bet.stake > available) {
      s = { status: 'void', odds: null, payout: 0, reason: 'funds' };
      rows.push({ bet, s });
      continue;
    }
    s = settleBet(bet, cards, settled, now);
    available -= bet.stake;
    if (s.status === 'open') {
      atStake += bet.stake;
      net -= bet.stake;
    } else {
      const decided = bet.kind === 'race' ? bet.round : seasonRange(seasonNumber(bet.round)).last;
      pending.push({ from: startsAtForRound(Math.max(1, decided)), coins: s.payout });
      net += s.payout - bet.stake;
      settledNet += s.payout - bet.stake;
    }
    rows.push({ bet, s });
  }
  rows.reverse();
  return { rows, net, settledNet, atStake };
}

/** The next race whose lights have not gone out: the one a race bet can still be placed on. */
export function bettableRound(now: number): number {
  let r = Math.max(1, Math.floor((now - startsAtForRound(1)) / (24 * 60 * 60 * 1000)));
  while (startsAtForRound(r) <= now) r++;
  while (r > 1 && startsAtForRound(r - 1) > now) r--;
  return r;
}

export function newBetId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
