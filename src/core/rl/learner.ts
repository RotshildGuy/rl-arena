import type { AlgorithmId } from './algorithms';
import type { EpisodeStats } from './trainerTypes';

/**
 * What one learner is told when the shared episode ends. Everything is indexed
 * by the learner's own seat list, not by the environment's — a learner never
 * needs to know which cars on the grid belong to somebody else.
 */
export interface EpisodeOutcome {
  /** Total shaped reward collected at each of its seats. */
  seatRewards: Float32Array;
  /** Game-native score (laps) at each of its seats. */
  seatScores: Float32Array;
  /** Best lap and quickest full run across its seats, when the game has laps. */
  bestLapMs: number | null;
  bestRaceMs: number | null;
  /** Environment steps the episode lasted. */
  steps: number;
}

/**
 * A learning algorithm that drives a subset of the seats in a shared
 * environment.
 *
 * This is the seam that lets several models train in the *same* race: the
 * session owns the environment and the clock, each learner owns its own network
 * and its own idea of progress. One learner holding every seat is exactly the
 * old single-model behaviour, so nothing special happens in the common case.
 */
export interface Learner {
  readonly algorithm: AlgorithmId;
  /** Episode for DQN, generation for the GA. */
  readonly episode: number;
  readonly envSteps: number;
  readonly gradSteps: number;
  /** Exploration level: epsilon for DQN, mutation scale for the GA. */
  readonly epsilon: number;
  /** How many seats it drives. */
  readonly seatCount: number;

  /** Called after the environment resets, before the first action. */
  beginEpisode(): void;
  /** Pick an action for one of its seats, `slot` being an index into its own seats. */
  act(slot: number, obs: Float32Array): number;
  /** One transition on one of its seats. Called only for seats still running. */
  observe(
    slot: number,
    obs: Float32Array,
    action: number,
    reward: number,
    nextObs: Float32Array,
    done: boolean,
  ): void;
  /** Learning that happens once per environment step rather than per seat. */
  afterStep(): void;
  /** The shared episode ended. Returns stats only when a unit of progress completed. */
  endEpisode(outcome: EpisodeOutcome): EpisodeStats | null;
  /** The weights worth saving — for the GA, the best genome so far. */
  getWeights(): Float32Array;
  /** Short "where are we" line; a GA generation spans many episodes. */
  progressNote(episodeSteps: number): string;
}
