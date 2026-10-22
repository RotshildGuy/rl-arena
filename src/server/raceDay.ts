import { buildRaceCard, eligibleEntries } from '../core/champ/card';
import { MIN_ENTRIES } from '../core/champ/format';
import { HOUSE_DRIVERS, isHouse } from '../core/champ/house';
import { raceIdForRound } from '../core/champ/schedule';
import { runRaceDay } from '../core/champ/sim';
import type { ArenaStore } from '../storage/arena';

/**
 * The race day, run on the server.
 *
 * The same thing `syncChampionship` does for one round when somebody opens the
 * site - build the card if it is missing, then run the day if its result is -
 * so the race happens whether or not anyone is watching. The server runs it
from the lock at 19:55, ahead of the browsers; they only read a result once
the lights are out at 20:00. Bundled into
 * `functions/raceDay.js` by `npm run build:functions` and called every minute
 * of the race window by `raceResult` in `functions/index.js`.
 *
 * It writes create-only, like the browsers do: whichever of the server and a
 * browser lands first is the record, and since both run the same deterministic
 * code on the same frozen data, they would have written the same thing.
 */

/** The part of the arena a race day needs. The functions implement it on the admin SDK. */
export type RaceStore = Pick<
  ArenaStore,
  'listEntries' | 'loadEntryWeights' | 'getCard' | 'putCard' | 'loadRaceWeights' | 'getResult' | 'putResult'
>;

/**
 * The house drivers whose weights the caller has to supply - from the same
 * files the site serves under `/house/`, which the build copies next to the
 * bundle.
 */
export const HOUSE_IDS: readonly string[] = HOUSE_DRIVERS.map((h) => h.id);

export type RaceDayOutcome = 'raced' | 'already' | 'no-field' | 'no-card';

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

  if (await store.getResult(raceId)) return 'already';
  const weights = await store.loadRaceWeights(raceId);
  if (weights.size < MIN_ENTRIES) return 'no-field';
  await store.putResult(runRaceDay(card, weights));
  return 'raced';
}
