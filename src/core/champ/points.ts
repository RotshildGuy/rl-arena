import type { DayPlace, RaceCard, RaceResult } from './types';

/**
 * The scoring system Formula 1 has used since 2010, with the fastest-lap bonus
 * added in 2019: points to the top ten, and one extra to the fastest lap only if
 * its driver finished in the points.
 */
export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
export const FASTEST_LAP_BONUS = 1;
export const POINTS_PLACES = POINTS.length;

export function pointsForPosition(position: number): number {
  return position >= 1 && position <= POINTS.length ? POINTS[position - 1] : 0;
}

export interface DriverStanding {
  entryId: string;
  driver: string;
  team: string;
  tag: string;
  points: number;
  wins: number;
  podiums: number;
  poles: number;
  fastestLaps: number;
  starts: number;
  finishes: number;
  dnfs: number;
  bestFinish: number | null;
  /** How many times this car took each position — the championship tie-break. */
  counts: number[];
  /** Position per race id, for the results grid. */
  byRace: Record<string, { position: number; points: number; status: 'finished' | 'dnf' }>;
  position: number;
}

export interface TeamStanding {
  team: string;
  points: number;
  wins: number;
  podiums: number;
  entries: string[];
  counts: number[];
  position: number;
}

/**
 * Formula 1's countback. Equal points are split by who has the most wins, then
 * the most second places, and so on down the order — never alphabetically and
 * never by who scored first.
 */
function countback(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (b[i] ?? 0) - (a[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export interface SeasonInput {
  cards: RaceCard[];
  results: Map<string, RaceResult>;
}

export function buildStandings({ cards, results }: SeasonInput): {
  drivers: DriverStanding[];
  teams: TeamStanding[];
} {
  const byEntry = new Map<string, DriverStanding>();

  const ensure = (entryId: string, driver: string, team: string, tag: string): DriverStanding => {
    let d = byEntry.get(entryId);
    if (!d) {
      d = {
        entryId,
        driver,
        team,
        tag,
        points: 0,
        wins: 0,
        podiums: 0,
        poles: 0,
        fastestLaps: 0,
        starts: 0,
        finishes: 0,
        dnfs: 0,
        bestFinish: null,
        counts: [],
        byRace: {},
        position: 0,
      };
      byEntry.set(entryId, d);
    } else {
      // The newest card wins: an owner may have renamed the model since.
      d.driver = driver;
      d.team = team;
      d.tag = tag;
    }
    return d;
  };

  const ordered = [...cards].sort((a, b) => a.round - b.round);

  for (const card of ordered) {
    const result = results.get(card.id);
    const names = new Map(card.entries.map((e) => [e.id, e]));
    if (!result) {
      // Still entered, so the driver shows up in the table even before lights out.
      for (const e of card.entries) ensure(e.id, e.driver, e.team, e.tag);
      continue;
    }
    for (const place of result.places) {
      const e = names.get(place.entryId);
      const d = ensure(place.entryId, e?.driver ?? '—', e?.team ?? '—', e?.tag ?? '???');
      d.starts++;
      d.points += place.points;
      if (place.status === 'dnf') d.dnfs++;
      else d.finishes++;
      if (place.position === 1) d.wins++;
      if (place.position <= 3) d.podiums++;
      if (d.bestFinish === null || place.position < d.bestFinish) d.bestFinish = place.position;
      d.counts[place.position - 1] = (d.counts[place.position - 1] ?? 0) + 1;
      d.byRace[card.id] = { position: place.position, points: place.points, status: place.status };
    }
    if (result.pole) {
      const e = names.get(result.pole);
      ensure(result.pole, e?.driver ?? '—', e?.team ?? '—', e?.tag ?? '???').poles++;
    }
    if (result.fastestLap) {
      const e = names.get(result.fastestLap.entryId);
      ensure(result.fastestLap.entryId, e?.driver ?? '—', e?.team ?? '—', e?.tag ?? '???').fastestLaps++;
    }
  }

  const drivers = [...byEntry.values()].sort((a, b) => b.points - a.points || countback(a.counts, b.counts));
  drivers.forEach((d, i) => (d.position = i + 1));

  const teamMap = new Map<string, TeamStanding>();
  for (const d of drivers) {
    let t = teamMap.get(d.team);
    if (!t) {
      t = { team: d.team, points: 0, wins: 0, podiums: 0, entries: [], counts: [], position: 0 };
      teamMap.set(d.team, t);
    }
    t.points += d.points;
    t.wins += d.wins;
    t.podiums += d.podiums;
    t.entries.push(d.entryId);
    d.counts.forEach((c, i) => (t!.counts[i] = (t!.counts[i] ?? 0) + (c ?? 0)));
  }
  const teams = [...teamMap.values()].sort((a, b) => b.points - a.points || countback(a.counts, b.counts));
  teams.forEach((t, i) => (t.position = i + 1));

  return { drivers, teams };
}

/**
 * Minimum share of the winner's distance a car must cover to be classified.
 *
 * Formula 1 uses 90%. Half is the right number here: these are learned drivers,
 * not professional ones, and a model that spins into the wall on lap two should
 * not collect eight points for having been on the grid — but one that races most
 * of the distance and then retires deserves to be in the results.
 */
export const CLASSIFY_FRACTION = 0.5;

/** Points for one race day, once every session has been classified. */
export function awardPoints(
  places: Array<Omit<DayPlace, 'points' | 'classified'> & { laps: number }>,
  fastestLapEntry: string | null,
  winnerLaps: number,
): DayPlace[] {
  const needed = winnerLaps * CLASSIFY_FRACTION;
  return places.map(({ laps, ...p }) => {
    const classified = laps >= needed;
    let points = classified ? pointsForPosition(p.position) : 0;
    if (
      classified &&
      fastestLapEntry === p.entryId &&
      p.position <= POINTS_PLACES &&
      p.status === 'finished'
    ) {
      points += FASTEST_LAP_BONUS;
    }
    return { ...p, points, classified };
  });
}
