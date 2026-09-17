import type { DqnHyper } from '../core/rl/dqn';
import type { GaHyper } from '../core/rl/ga';
import type { AlgorithmId } from '../core/rl/algorithms';
import type { EpisodeStats } from '../core/rl/trainerTypes';
import type { RewardConfig } from '../core/games/types';

/** watch = real time, fast = ~10x, turbo = headless, as fast as the CPU allows. */
export type SpeedMode = 'watch' | 'fast' | 'turbo';

/** One model in the session. Several of them share one grid and race each other. */
export interface TrainSlotInit {
  algorithm: AlgorithmId;
  /** This model's own reward table — models on the same grid may differ. */
  rewards: RewardConfig;
  hyper: Partial<DqnHyper>;
  gaHyper: Partial<GaHyper>;
  /** Present when continuing an existing model. */
  weightsB64?: string;
  envSteps?: number;
  gradSteps?: number;
  episode?: number;
}

export interface TrainInit {
  gameId: string;
  /** Shared environment settings: track, car count, laps. */
  config: Record<string, unknown>;
  seed: number;
  slots: TrainSlotInit[];
  speed: SpeedMode;
}

export interface SlotLive {
  episode: number;
  envSteps: number;
  gradSteps: number;
  epsilon: number;
  loss: number;
  note: string;
}

export interface SlotWeights {
  weightsB64: string;
  envSteps: number;
  gradSteps: number;
  episode: number;
}

export type ToTrainer =
  | { type: 'init'; init: TrainInit }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'setSpeed'; speed: SpeedMode }
  | { type: 'setRewards'; slot: number; rewards: RewardConfig }
  | { type: 'requestWeights'; tag: string }
  | { type: 'dispose' };

export type FromTrainer =
  /** Which environment seats each model drives, so the UI can label the cars. */
  | { type: 'ready'; seats: number[][] }
  | { type: 'episode'; slot: number; stats: EpisodeStats }
  | { type: 'live'; stepsPerSec: number; slots: SlotLive[] }
  | { type: 'snapshot'; snap: unknown }
  | { type: 'weights'; tag: string; slots: SlotWeights[] }
  | { type: 'error'; message: string };

export type { EpisodeStats };
