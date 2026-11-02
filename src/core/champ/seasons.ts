import { buildStandings, type DriverStanding, type TeamStanding } from './points';
import { seasonNumber, seasonRange, startsAtForRound } from './schedule';
import type { RaceCard, RaceResult } from './types';

/**
 * Season tables and the champions of seasons gone by.
 *
 * Nothing here is stored. A season's champion is what its table says once its
 * last race is over, and the table is computed from race results that are
 * create-only - so the archive cannot drift from the races, and there is no
 * "close the season" step that somebody would have to be online to run.
 */

/** The race days of one season. */
export function seasonCards(cards: RaceCard[], n: number): RaceCard[] {
  return cards.filter((c) => seasonNumber(c.round) === n);
}

/** How long after the final's lights a season closes even without its result. */
const FINAL_GRACE_MS = 3 * 60 * 60 * 1000;

/**
 * Over: its final round has been run and settled - or its lights went out
 * hours ago and nothing came of it. That covers a grid too thin to race (no
 * card at all) and a card whose race never produced a result (the server gave
 * up after building it): either way the season is decided by the rounds that
 * did run, instead of waiting for a final that is never coming.
 *
 * `settled` is `settledResults`, so a final still on air does not crown anybody.
 */
export function seasonComplete(n: number, cards: RaceCard[], settled: Map<string, RaceResult>, now: number): boolean {
  const { last } = seasonRange(n);
  const final = cards.find((c) => c.round === last);
  if (final && settled.has(final.id)) return true;
  return now >= startsAtForRound(last) + FINAL_GRACE_MS;
}

export interface SeasonHonours {
  season: number;
  first: number;
  last: number;
  /** Race days actually held. */
  races: number;
  driver: DriverStanding | null;
  team: TeamStanding | null;
  /** The driver who finished second, for the "by how much". */
  runnerUp: DriverStanding | null;
}

/** Every finished season with at least one race, newest first. */
export function hallOfFame(cards: RaceCard[], settled: Map<string, RaceResult>, now: number): SeasonHonours[] {
  const seasons = [...new Set(cards.map((c) => seasonNumber(c.round)))].sort((a, b) => b - a);
  const out: SeasonHonours[] = [];
  for (const n of seasons) {
    if (!seasonComplete(n, cards, settled, now)) continue;
    const mine = seasonCards(cards, n).filter((c) => settled.has(c.id));
    if (mine.length === 0) continue;
    const table = buildStandings({ cards: mine, results: settled });
    const { first, last } = seasonRange(n);
    out.push({
      season: n,
      first,
      last,
      races: mine.length,
      driver: table.drivers[0] ?? null,
      team: table.teams[0] ?? null,
      runnerUp: table.drivers[1] ?? null,
    });
  }
  return out;
}

/**
 * Teams in their first season: accounts whose first race of all is in season
 * `n`. Their own table is somewhere a newcomer can win something this week,
 * whoever has been piling up points since the first round. House cars are not
 * rookies; they are furniture.
 */
export function rookieUids(cards: RaceCard[], n: number): Set<string> {
  const first = new Map<string, number>();
  for (const c of cards) {
    for (const e of c.entries) {
      if (e.uid === 'house') continue;
      first.set(e.uid, Math.min(first.get(e.uid) ?? Infinity, c.round));
    }
  }
  const { first: from, last } = seasonRange(n);
  return new Set([...first].filter(([, r]) => r >= from && r <= last).map(([uid]) => uid));
}
