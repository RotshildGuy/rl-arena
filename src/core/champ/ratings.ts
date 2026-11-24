import type { RaceCard, RaceResult } from './types';

/**
 * Hidden ratings, for the betting odds (`bets.ts`).
 *
 * Every driver and every team has an Elo rating that moves with each race day
 * it takes part in, over every season since the start - a champion of season
 * 2 is still rated as one in season 5. Each day is scored as a round of
 * head-to-heads: every car against every other car on the day's
 * classification, the one ahead winning. A team is scored on its best car of
 * the day.
 *
 * The ratings are never shown. Nothing in the UI prints them; they only come
 * out as the odds, the way a bookmaker's model does. Like the standings and
 * the coins they are not stored anywhere: a pure function of results that are
 * already published, so every browser and the server work out the same
 * numbers.
 */
export const BASE_RATING = 1500;
/** How far one race day can move a rating (Elo: spread over its head-to-heads; Plackett-Luce: per place). */
export const RATING_K = 40;
/** How the order is read: see `ratePL`. 0 is plain Elo. */
export const RATING_STAGES = 3;

export interface Ratings {
  /** By entry id. */
  drivers: Map<string, number>;
  /** By account uid. */
  teams: Map<string, number>;
  /** Race days counted. */
  races: number;
}

export function expected(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

/** One round of head-to-heads over an order, best first. */
function rate(table: Map<string, number>, order: string[], K: number): void {
  const n = order.length;
  if (n < 2) return;
  const before = order.map((id) => table.get(id) ?? BASE_RATING);
  const delta = new Array<number>(n).fill(0);
  const k = K / (n - 1);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // i finished ahead of j.
      const e = expected(before[i], before[j]);
      delta[i] += k * (1 - e);
      delta[j] -= k * (1 - e);
    }
  }
  order.forEach((id, i) => table.set(id, before[i] + delta[i]));
}

/**
 * The same order read from the front, the way the odds read a race: who beat
 * the whole field, then who beat the rest, and so on for `stages` places.
 * Each place moves its winner up by what it was not expected to win, and
 * everybody else still in by what they were (a Plackett-Luce step). Winning
 * counts for more than finishing ahead of the back markers, which is what a
 * bet on the winner needs.
 */
function ratePL(table: Map<string, number>, order: string[], eta: number, stages: number): void {
  const n = order.length;
  if (n < 2) return;
  const before = order.map((id) => table.get(id) ?? BASE_RATING);
  const s = before.map((r) => 10 ** (r / 400));
  const delta = new Array<number>(n).fill(0);
  for (let k = 0; k < Math.min(stages, n - 1); k++) {
    let total = 0;
    for (let j = k; j < n; j++) total += s[j];
    for (let j = k; j < n; j++) delta[j] -= eta * (s[j] / total);
    delta[k] += eta;
  }
  order.forEach((id, i) => table.set(id, before[i] + delta[i]));
}

/**
 * The ratings after every settled race day before `round` (all of them when
 * `round` is omitted), in calendar order. Pass settled results only
 * (`settledResults`), so a race still on air moves nothing.
 */
export function ratingsBefore(
  cards: RaceCard[],
  settled: Map<string, RaceResult>,
  round = Infinity,
  k = RATING_K,
  /** 0: Elo over every pair; more: Plackett-Luce over that many places from the front. */
  stages = RATING_STAGES,
): Ratings {
  const update = (table: Map<string, number>, order: string[]) => (stages > 0 ? ratePL(table, order, k, stages) : rate(table, order, k));
  const drivers = new Map<string, number>();
  const teams = new Map<string, number>();
  let races = 0;
  const ordered = cards.filter((c) => c.round < round && settled.has(c.id)).sort((a, b) => a.round - b.round);
  for (const card of ordered) {
    const result = settled.get(card.id)!;
    const uidOf = new Map(card.entries.map((e) => [e.id, e.uid]));
    const order = [...result.places].sort((a, b) => a.position - b.position).map((p) => p.entryId);
    update(drivers, order);
    const teamOrder: string[] = [];
    for (const id of order) {
      const uid = uidOf.get(id);
      if (uid && !teamOrder.includes(uid)) teamOrder.push(uid);
    }
    update(teams, teamOrder);
    races++;
  }
  return { drivers, teams, races };
}
