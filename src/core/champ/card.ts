import { OBS_SIZE, OBS_VERSION, RACING_SPEC } from '../games/racing/rewards';
import {
  grandPrixName,
  lockAtForRound,
  physicsForRound,
  raceIdForRound,
  seedForRound,
  seasonForRound,
  startsAtForRound,
  trackForRound,
} from './schedule';
import { RACE_LAPS } from './format';
import { runQualifying } from './sim';
import type { ArenaEntry, RaceCard } from './types';
import { nameKey } from './names';
import { weightsFingerprint } from './copies';
import { isHouse, isHouseId, withHouse } from './house';

/**
 * Cars one team may put on the grid for a round.
 *
 * Two, like a real constructor. The garage refuses to register a third, but the
 * rule has to hold here as well: teams that were already over the limit when it
 * came in keep their entries, and the grid simply takes the two that registered
 * first. Every client computes the same field from the same entry list, so this
 * must stay a pure function of the data.
 *
 * A team is an account - together with any other account racing under the
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
 *
 * A thin grid is then topped up with house cars (`withHouse`), after every
 * real car has its seat.
 */
export function eligibleEntries(
  entries: ArenaEntry[],
  round: number,
  nameOwners?: ReadonlyMap<string, string>,
): ArenaEntry[] {
  const lock = lockAtForRound(round);
  const field = entries
    .filter(
      (e) =>
        !e.retired &&
        // The house is added below, by the rules, never by an entry claiming to be it.
        !isHouse(e) &&
        !isHouseId(e.id) &&
        e.gameId === 'racing' &&
        e.obsVersion === OBS_VERSION &&
        validArch(e) &&
        e.createdAt <= lock &&
        // A name that belongs to one account is raced only by that account. A car
        // that merely wears it is somebody impersonating the team, or a leftover
        // from before accounts, and neither gets a seat or adds points to it.
        !heldByAnother(e, nameOwners),
    )
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

  // Seniority decides which two: the cars that have been on the grid longest -
  // within the account the team races from now. One team can be spread over
  // several accounts (see `teamOf`), and the older ones are exactly the ones
  // nobody can reach any more: their cars could not be taken off, and by
  // seniority they would take every seat from the cars the team actually runs.
  const team = teamOf(field, nameOwners);
  const latest = new Map<string, number>();
  for (const e of field) latest.set(e.uid, Math.max(latest.get(e.uid) ?? 0, e.updatedAt));
  // Before all of that, the account that owns the team's name: a car that only
  // wears a name (`names/{key}` belongs to somebody else) can take a seat the
  // owner leaves empty, never one of the owner's.
  const ownsName = (e: ArenaEntry): number => (nameOwners?.get(nameKey(e.team)) === e.uid ? 0 : 1);
  const byPriority = [...field].sort(
    (a, b) =>
      ownsName(a) - ownsName(b) ||
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
  return withHouse(capField(field.filter((e) => chosen.has(e.id)), team), round);
}

/**
 * The most real cars one race day takes on. Qualifying runs every car, one after
 * another, inside one function call, and accounts cost nothing to make, so an
 * unbounded field is a way to make the day's race fail for everybody. When there
 * are more, the teams that have been racing longest keep their seats: a field
 * filled with brand-new accounts cannot push out the players who were there first.
 * The rest simply race the next day.
 */
export const MAX_FIELD = 60;

function capField(seated: ArenaEntry[], team: (e: ArenaEntry) => string): ArenaEntry[] {
  if (seated.length <= MAX_FIELD) return seated;
  const first = new Map<string, number>();
  const size = new Map<string, number>();
  for (const e of seated) {
    const t = team(e);
    first.set(t, Math.min(first.get(t) ?? Infinity, e.createdAt));
    size.set(t, (size.get(t) ?? 0) + 1);
  }
  const keep = new Set<string>();
  let total = 0;
  for (const t of [...first.keys()].sort((a, b) => first.get(a)! - first.get(b)! || a.localeCompare(b))) {
    if (total + size.get(t)! > MAX_FIELD) break;
    keep.add(t);
    total += size.get(t)!;
  }
  return seated.filter((e) => keep.has(team(e)));
}

function heldByAnother(e: ArenaEntry, owners?: ReadonlyMap<string, string>): boolean {
  const owner = owners?.get(nameKey(e.team));
  return owner !== undefined && owner !== e.uid;
}

/** Hidden layers a racing network may have, and how wide. A bound, not a style. */
const MAX_LAYERS = 4;
const MAX_WIDTH = 512;

/**
 * A network the race can actually build: the racing game's inputs and actions,
 * and a hidden shape within bounds. An entry is written by its owner's browser,
 * so a shape that would not load - or would not fit in memory - is a car that
 * never makes the grid, not a race day that fails for everyone.
 */
function validArch(e: ArenaEntry): boolean {
  const a = e.arch as Partial<ArenaEntry['arch']> | undefined;
  return (
    !!a &&
    a.obsSize === OBS_SIZE &&
    a.nActions === RACING_SPEC.actions.length &&
    Array.isArray(a.hidden) &&
    a.hidden.length >= 1 &&
    a.hidden.length <= MAX_LAYERS &&
    a.hidden.every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_WIDTH)
  );
}

/**
 * Which team an entry races for.
 *
 * An account, and every other account racing under the same team name. A name
 * belongs to one account now, but before there was a sign-in screen every
 * browser minted an anonymous identity of its own, and signing in elsewhere
 * left its cars behind under a uid nobody can use again - still wearing the
 * team's name, and still entitled, per account, to two seats of their own.
 */
function teamOf(entries: ArenaEntry[], nameOwners?: ReadonlyMap<string, string>): (e: ArenaEntry) => string {
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
  // With the registry at hand an entry only joins a team through a name its own
  // account holds. Without that, anybody could write cars wearing everybody
  // else's team names and fuse the whole field into one two-seat team.
  for (const e of entries) {
    if (nameOwners && nameOwners.get(nameKey(e.team)) !== e.uid) continue;
    union(`u\u0000${e.uid}`, `t\u0000${nameKey(e.team)}`);
  }
  return (e) => find(`u\u0000${e.uid}`);
}

/**
 * Build a race card: freeze the field, run qualifying, set the grid.
 *
 * Everything here is a pure function of the round number and the entry list, so
 * two clients that build the same card build exactly the same card.
 */
export function buildRaceCard(
  round: number,
  entries: ArenaEntry[],
  weights: Map<string, string>,
  nameOwners?: ReadonlyMap<string, string>,
  /**
   * The server draws this once, after the entry list is locked, so nobody can
   * work out the race in advance. Without one the seed is the round's fixed
   * value, which is what the offline mode and the tests use.
   */
  seedOverride?: number,
): RaceCard {
  const trackId = trackForRound(round);
  const seed = seedOverride ?? seedForRound(round);
  const field = eligibleEntries(entries, round, nameOwners);
  const physics = physicsForRound(round);
  return {
    id: raceIdForRound(round),
    seasonId: seasonForRound(round),
    round,
    name: grandPrixName(round),
    trackId,
    laps: RACE_LAPS,
    seed,
    startsAt: startsAtForRound(round),
    entries: field,
    qualifying: runQualifying(field, weights, trackId, seed, physics),
    createdAt: Date.now(),
    // Left off the card while it is the default, so a card from before the
    // switch is stored exactly as cards always were.
    ...(physics > 1 ? { physics } : {}),
    fingerprints: Object.fromEntries(
      field.filter((e) => weights.has(e.id)).map((e) => [e.id, weightsFingerprint(weights.get(e.id)!)]),
    ),
  };
}
