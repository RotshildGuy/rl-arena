import { mulberry32, randInt } from '../rng';

/**
 * Which circuits a season races on.
 *
 * Season 1 went round the original four in order, round after round. From
 * season 2 (`TRACK_POOL_FROM_SEASON`) every season draws its own
 * rotation from a pool: `ROTATION_SIZE` circuits, raced in the drawn order and
 * round again until the season is over. New circuits join the pool and take
 * turns with the old ones instead of making the rotation longer.
 *
 * Every client builds race cards for itself, so the draw is a pure function of
 * the season - a seeded shuffle, no clock, no network. And it must never
 * change once a season has started: the pools below are append-only, each
 * applying from the season it names on, and `npm run sanity` pins the
 * rotations already drawn.
 */

/** The calendar before the pool: round r ran `LEGACY_ROTATION[(r - 1) % 4]`. */
export const LEGACY_ROTATION: readonly string[] = ['oval', 'kidney', 'technical', 'speedway'];

/** How many circuits one season visits. A season is eight rounds: each of them twice. */
export const ROTATION_SIZE = 4;

export interface TrackPool {
  /** The first season this pool is drawn from. */
  fromSeason: number;
  trackIds: readonly string[];
  /**
   * Circuits that open the pool's first season for certain: a new circuit is
   * raced the season it arrives in, not whenever the draw gets round to it.
   * They take the last places of that season's draw; later seasons draw freely.
   */
  debut?: readonly string[];
}

/**
 * Append-only. To add a circuit, add a new entry whose `fromSeason` has not
 * started yet, never edit an entry a season has already drawn from.
 */
export const TRACK_POOLS: readonly TrackPool[] = [
  {
    // Season 1 (from the launch, 25.10) opens on the new car physics and the
    // house team; it keeps the tracks everybody is retraining on, and the pool
    // waits a season: season 2, from Monday 2.11.
    fromSeason: 2,
    trackIds: [
      'oval', 'kidney', 'technical', 'speedway',
      'stadium', 'triangle', 'serpent', 'clover', 'coast', 'ring',
    ],
  },
  {
    // Season 3: the street circuit with the hairpin joins, and races its first season.
    fromSeason: 3,
    trackIds: [
      'oval', 'kidney', 'technical', 'speedway',
      'stadium', 'triangle', 'serpent', 'clover', 'coast', 'ring',
      'harbor',
    ],
    debut: ['harbor'],
  },
];

/** The first season whose circuits are drawn rather than cycled. */
export const TRACK_POOL_FROM_SEASON = TRACK_POOLS[0].fromSeason;

export function poolForSeason(n: number): TrackPool | null {
  let found: TrackPool | null = null;
  for (const p of TRACK_POOLS) if (p.fromSeason <= n) found = p;
  return found;
}

/** FNV-1a of the season id (`S3`, as `seasonId` writes it), so the draw is salted by the season. */
function seasonSeed(n: number): number {
  let h = 2166136261;
  for (const ch of `S${n}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/**
 * A season's rotation as drawn, before it is fitted to the season before it:
 * a Fisher-Yates shuffle of the pool, cut to `ROTATION_SIZE`.
 */
export function drawRotation(n: number): string[] {
  const pool = poolForSeason(n);
  if (!pool) return [...LEGACY_ROTATION];
  const ids = [...pool.trackIds];
  const rng = mulberry32(seasonSeed(n));
  for (let i = ids.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const drawn = ids.slice(0, Math.min(ROTATION_SIZE, ids.length));
  if (pool.fromSeason === n) {
    // A debut the draw left out takes the last place not already a debut's.
    for (const id of pool.debut ?? []) {
      if (drawn.includes(id)) continue;
      for (let k = drawn.length - 1; k >= 0; k--) {
        if (!pool.debut!.includes(drawn[k])) {
          drawn[k] = id;
          break;
        }
      }
    }
  }
  return drawn;
}

/**
 * The rotation a season races: the draw, with its first two circuits swapped
 * if the first is where the season before ended - no circuit two days running.
 * `previousLast` is the track of the round before the season's first.
 */
export function fitRotation(drawn: string[], previousLast: string): string[] {
  if (drawn.length > 1 && drawn[0] === previousLast) return [drawn[1], drawn[0], ...drawn.slice(2)];
  return drawn;
}
