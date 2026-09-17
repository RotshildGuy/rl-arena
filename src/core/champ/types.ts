import type { ModelArch } from '../../storage/types';
import type { AlgorithmId } from '../rl/algorithms';

/**
 * One car on the grid, for a whole season.
 *
 * An entry is the *driver*: it keeps its identity and its championship points
 * when its owner uploads better weights, exactly the way a real driver keeps
 * their points when the team brings an upgrade. The owner is the *team*.
 */
export interface ArenaEntry {
  id: string;
  /** Anonymous Firebase uid of the owner. Only used to enforce write access. */
  uid: string;
  /** Shown as the driver name — the model's name. */
  driver: string;
  /** Shown as the team name — the competitor who trained it. */
  team: string;
  gameId: string;
  algorithm: AlgorithmId;
  arch: ModelArch;
  obsVersion: number;
  /** Three-letter tag, the way F1 abbreviates drivers on a timing screen. */
  tag: string;
  /** When this driver first entered the championship. Gates retroactive rounds. */
  createdAt: number;
  /** Last weights upload. */
  updatedAt: number;
  /** Model id in the owner's private library, for their own reference. */
  modelId: string;
  /** Episodes of training behind the current weights — shown on the entry list. */
  episodes: number;
  /**
   * Legacy: an entry withdrawn back when withdrawal existed. Taking a car off
   * the grid deletes its entry now, so nothing sets this any more — it is still
   * honoured on read so a car withdrawn under the old rules stays off the grid
   * and reads as unregistered until its model is entered again.
   */
  retired?: boolean;
}

/** An entry plus the weights frozen for one specific race. */
export interface RaceCar {
  entryId: string;
  weightsB64: string;
}

export type SessionKind = 'race' | 'heat' | 'final';

/** One session of a race day: a heat, a final, or the single race of a small grid. */
export interface SessionPlan {
  id: string;
  kind: SessionKind;
  /** Hebrew label — "מרוץ", "מקצה 2", "חצי גמר 1", "גמר". */
  name: string;
  /** Index of the elimination round this belongs to; the final is last. */
  round: number;
  /** Starting grid, in order. Empty for sessions fed by an earlier round. */
  grid: string[];
  /** How many cars go through to the next round. 0 for the final. */
  advance: number;
  /** Lights out, relative to the race day's start time. */
  offsetMs: number;
}

export interface QualiLap {
  entryId: string;
  /** null when the car never completed a clean lap — it starts from the back. */
  bestLapMs: number | null;
  sectorsMs: (number | null)[];
  topSpeed: number;
}

/** Everything needed to reproduce a race day, byte for byte. */
export interface RaceCard {
  id: string;
  seasonId: string;
  round: number;
  name: string;
  trackId: string;
  laps: number;
  seed: number;
  /** Lights out for the first session. */
  startsAt: number;
  /** Entrants at lock time, without weights. */
  entries: ArenaEntry[];
  /** Grid-setting session, run at card creation. Ordered fastest first. */
  qualifying: QualiLap[];
  createdAt: number;
}

export interface Finish {
  entryId: string;
  position: number;
  laps: number;
  /** Race time from lights out. null for a retirement. */
  totalMs: number | null;
  /** Behind the winner. null for the winner and for retirements. */
  gapMs: number | null;
  bestLapMs: number | null;
  bestSectorsMs: (number | null)[];
  lapTimesMs: number[];
  /** Position at the end of each completed lap, for the lap chart. */
  lapPositions: number[];
  topSpeed: number;
  overtakes: number;
  wallHits: number;
  carHits: number;
  lapsLed: number;
  status: 'finished' | 'dnf';
  /** Where the car started. */
  gridPos: number;
}

export interface SessionResult {
  sessionId: string;
  /** Starting order. Stored because heats decide the grids of later sessions. */
  grid: string[];
  classification: Finish[];
  fastestLap: { entryId: string; ms: number } | null;
}

export interface DayPlace {
  entryId: string;
  position: number;
  points: number;
  /** Which session decided this car's day. */
  eliminatedIn: string | null;
  status: 'finished' | 'dnf';
  /**
   * Covered enough of the winner's distance to be classified. Unclassified cars
   * keep their place in the order but score nothing.
   */
  classified: boolean;
}

export interface RaceResult {
  raceId: string;
  seasonId: string;
  computedAt: number;
  sessions: SessionResult[];
  /** The day's classification, points included. */
  places: DayPlace[];
  pole: string | null;
  fastestLap: { entryId: string; ms: number } | null;
}
