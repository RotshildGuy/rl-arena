import { buildRaceCard, eligibleEntries } from '../core/champ/card';
import { MIN_ENTRIES } from '../core/champ/format';
import { HOUSE_DRIVERS, isHouse } from '../core/champ/house';
import { raceIdForRound } from '../core/champ/schedule';
import { runRaceDay } from '../core/champ/sim';
import type { DayReplay } from '../core/champ/replay';
import type { RaceCard, RaceResult } from '../core/champ/types';
import type { ArenaStore } from '../storage/arena';

/**
 * The race day, run on the server.
 *
 * The same thing `syncChampionship` does for one round when somebody opens the
 * site - build the card if it is missing, then run the day if its result is -
 * so the race happens whether or not anyone is watching. The server runs it
 * from the lock at 19:55, ahead of the browsers; they only read a result once
 * the lights are out at 20:00. Bundled into
 * `functions/raceDay.js` by `npm run build:functions` and called every minute
 * of the race window by `raceResult` in `functions/index.js`.
 *
 * It writes create-only: whichever of the server and a browser still running
 * an older version of the site lands first is the record, and since both run
 * the same deterministic code on the same frozen data, they would have written
 * the same thing.
 *
 * The server is also the only place weights are read. A browser watches a race
 * from its replay - the actions each car took (`core/champ/replay.ts`) - which
 * is written here, before the result, so a result never exists without one.
 */

/** The part of the arena a race day needs. The functions implement it on the admin SDK. */
export type RaceStore = Pick<
  ArenaStore,
  'listEntries' | 'loadEntryWeights' | 'getCard' | 'putCard' | 'loadRaceWeights' | 'getResult' | 'putResult'
> & {
  /** Whether a replay was stored for the day - or found impossible, so not tried again. */
  hasReplay(raceId: string): Promise<boolean>;
  /** `null`: the day did not reproduce, and has no replay. */
  putReplay(raceId: string, replay: DayReplay | null): Promise<void>;
};

/**
 * The house drivers whose weights the caller has to supply - from the same
 * files the site serves under `/house/`, which the build copies next to the
 * bundle.
 */
export const HOUSE_IDS: readonly string[] = HOUSE_DRIVERS.map((h) => h.id);

export type RaceDayOutcome = 'raced' | 'replayed' | 'already' | 'no-field' | 'no-card' | 'mismatch';

export async function raceRound(store: RaceStore, round: number, house: ReadonlyMap<string, string>): Promise<RaceDayOutcome> {
  const raceId = raceIdForRound(round);
  let card = await store.getCard(raceId);
  if (!card) {
    const entries = await store.listEntries();
    const field = eligibleEntries(entries, round);
    if (field.length < MIN_ENTRIES) return 'no-field';
    const pairs = await Promise.all(
      field.map(
        async (e) =>
          [e.id, isHouse(e) ? (house.get(e.id) ?? null) : await store.loadEntryWeights(e.id)] as [string, string | null],
      ),
    );
    const weights = new Map(pairs.filter((p): p is [string, string] => p[1] !== null));
    // As in the browser: a house car without its weights would be frozen onto
    // the card without a car to drive.
    if (weights.size < MIN_ENTRIES || field.some((e) => isHouse(e) && !weights.has(e.id))) return 'no-card';
    card = await store.putCard(buildRaceCard(round, entries, weights), weights);
  }

  const existing = await store.getResult(raceId);
  if (existing) return replayRound(store, card, existing);
  const weights = await store.loadRaceWeights(raceId);
  if (weights.size < MIN_ENTRIES) return 'no-field';
  const replay: DayReplay = new Map();
  const result = runRaceDay(card, weights, replay);
  await store.putReplay(raceId, replay);
  await store.putResult(result);
  return 'raced';
}

/**
 * Give a day that was raced without a replay its replay: race it again,
 * recording, from the weights frozen on its card. Only kept if it reproduces
 * the stored result exactly - a replay that drove a different race from the
 * timing sheet would be worse than none.
 */
export async function replayRound(store: RaceStore, card: RaceCard, result: RaceResult): Promise<RaceDayOutcome> {
  if (await store.hasReplay(card.id)) return 'already';
  const weights = await store.loadRaceWeights(card.id);
  const replay: DayReplay = new Map();
  const again = runRaceDay(card, weights, replay);
  if (canonical(again.sessions) !== canonical(result.sessions)) {
    await store.putReplay(card.id, null);
    return 'mismatch';
  }
  await store.putReplay(card.id, replay);
  return 'replayed';
}

/** JSON with keys sorted: Firestore hands maps back in its own key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}
