import { OBS_VERSION } from '../games/racing/rewards';
import { grandPrixName, lockAtForRound, raceIdForRound, seedForRound, SEASON_ID, startsAtForRound, trackForRound } from './schedule';
import { RACE_LAPS } from './format';
import { runQualifying } from './sim';
import type { ArenaEntry, RaceCard } from './types';
import { nameKey } from './names';

/**
 * Cars one team may put on the grid for a round.
 *
 * Two, like a real constructor. The garage refuses to register a third, but the
 * rule has to hold here as well: teams that were already over the limit when it
 * came in keep their entries, and the grid simply takes the two that registered
 * first. Every client computes the same field from the same entry list, so this
 * must stay a pure function of the data.
 *
 * A team is an account — together with any other account racing under the
 * same team name, since a name belongs to one account (`names/{key}`) and the
 * other accounts are that same person's identities from before signing in.
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

  // Seniority decides which two: the cars that have been on the grid longest —
  // within the account the team races from now. One team can be spread over
  // several accounts (see `teamOf`), and the older ones are exactly the ones
  // nobody can reach any more: their cars could not be taken off, and by
  // seniority they would take every seat from the cars the team actually runs.
  const team = teamOf(field);
  const latest = new Map<string, number>();
  for (const e of field) latest.set(e.uid, Math.max(latest.get(e.uid) ?? 0, e.updatedAt));
  const byPriority = [...field].sort(
    (a, b) =>
      (latest.get(b.uid) ?? 0) - (latest.get(a.uid) ?? 0) ||
      a.uid.localeCompare(b.uid) ||
      a.createdAt - b.createdAt ||
      a.id.localeCompare(b.id),
  );
  const perTeam = new Map<string, number>();
  const chosen = new Set<string>();
  for (const e of byPriority) {
    const t = team(e);
    const n = perTeam.get(t) ?? 0;
    perTeam.set(t, n + 1);
    if (n < MAX_CARS_PER_TEAM) chosen.add(e.id);
  }
  return field.filter((e) => chosen.has(e.id));
}

/**
 * Which team an entry races for.
 *
 * An account, and every other account racing under the same team name. A name
 * belongs to one account now, but before there was a sign-in screen every
 * browser minted an anonymous identity of its own, and signing in elsewhere
 * left its cars behind under a uid nobody can use again — still wearing the
 * team's name, and still entitled, per account, to two seats of their own.
 */
function teamOf(entries: ArenaEntry[]): (e: ArenaEntry) => string {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const up = parent.get(x) ?? x;
    if (up === x) return x;
    const root = find(up);
    parent.set(x, root);
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const e of entries) union(`u\u0000${e.uid}`, `t\u0000${nameKey(e.team)}`);
  return (e) => find(`u\u0000${e.uid}`);
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
