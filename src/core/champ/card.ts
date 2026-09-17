import { OBS_VERSION } from '../games/racing/rewards';
import { grandPrixName, lockAtForRound, raceIdForRound, seedForRound, SEASON_ID, startsAtForRound, trackForRound } from './schedule';
import { RACE_LAPS } from './format';
import { runQualifying } from './sim';
import type { ArenaEntry, RaceCard } from './types';

/**
 * Cars one team may put on the grid for a round.
 *
 * Two, like a real constructor. The garage refuses to register a third, but the
 * rule has to hold here as well: teams that were already over the limit when it
 * came in keep their entries, and the grid simply takes the two that registered
 * first. Every client computes the same field from the same entry list, so this
 * must stay a pure function of the data.
 */
export const MAX_CARS_PER_TEAM = 2;

/**
 * Who is eligible for a given round.
 *
 * The `createdAt` cut is what keeps the championship honest when a round is run
 * late: a model entered this afternoon cannot collect points for a race that was
 * supposed to happen last Tuesday.
 */
export function eligibleEntries(entries: ArenaEntry[], round: number): ArenaEntry[] {
  const lock = lockAtForRound(round);
  const field = entries
    .filter(
      (e) =>
        !e.retired &&
        e.gameId === 'racing' &&
        e.obsVersion === OBS_VERSION &&
        e.createdAt <= lock,
    )
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

  // Seniority decides which two: the cars that have been on the grid longest.
  const perTeam = new Map<string, number>();
  return field.filter((e) => {
    const n = perTeam.get(e.team) ?? 0;
    perTeam.set(e.team, n + 1);
    return n < MAX_CARS_PER_TEAM;
  });
}

/**
 * Build a race card: freeze the field, run qualifying, set the grid.
 *
 * Everything here is a pure function of the round number and the entry list, so
 * two clients that build the same card build exactly the same card.
 */
export function buildRaceCard(round: number, entries: ArenaEntry[], weights: Map<string, string>): RaceCard {
  const trackId = trackForRound(round);
  const seed = seedForRound(round);
  const field = eligibleEntries(entries, round);
  return {
    id: raceIdForRound(round),
    seasonId: SEASON_ID,
    round,
    name: grandPrixName(round),
    trackId,
    laps: RACE_LAPS,
    seed,
    startsAt: startsAtForRound(round),
    entries: field,
    qualifying: runQualifying(field, weights, trackId, seed),
    createdAt: Date.now(),
  };
}
