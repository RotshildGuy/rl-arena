import type { RewardConfig } from '../games/types';
import type { AlgorithmId } from './algorithms';

export interface EpisodeStats {
  /** Episode for DQN, generation for the GA. */
  episode: number;
  /** Mean total reward per agent. */
  reward: number;
  steps: number;
  /** Mean game-native score per agent (laps, points, ...). */
  score: number;
  /** Epsilon for DQN, mutation scale for the GA. */
  epsilon: number;
  /** TD loss for DQN, fitness spread for the GA. */
  loss: number;
  envSteps: number;
  /** Gradient steps for DQN, generations for the GA. */
  gradSteps: number;
  /** Fastest lap any agent set this episode, when the game has laps. */
  bestLapMs?: number | null;
  /** Quickest full run this episode — the whole-track time. */
  bestRaceMs?: number | null;
}

/**
 * What the worker and the dashboard need from a training algorithm. Keeping this
 * narrow is what lets DQN and neuroevolution share the same worker, the same
 * charts and the same save format.
 */
export interface TrainerLike {
  readonly gameId: string;
  readonly algorithm: AlgorithmId;
  readonly episode: number;
  readonly envSteps: number;
  readonly gradSteps: number;
  readonly epsilon: number;
  /** Advance one environment step. Returns stats only when a unit of progress completes. */
  stepOnce(): EpisodeStats | null;
  snapshot(): unknown;
  setRewards(rewards: RewardConfig): void;
  /** The weights that should be saved — for the GA, the best genome so far. */
  getWeights(): Float32Array;
  /**
   * Short "where are we" line for the dashboard. A GA generation can span tens of
   * thousands of steps, so without this the UI looks frozen between generations.
   */
  progressNote(): string;
}
