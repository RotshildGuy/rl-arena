import type { DqnHyper } from '../core/rl/dqn';
import type { GaHyper } from '../core/rl/ga';
import type { AlgorithmId } from '../core/rl/algorithms';
import type { RewardConfig } from '../core/games/types';

export interface ModelArch {
  obsSize: number;
  hidden: number[];
  nActions: number;
}

export interface TrainingPoint {
  episode: number;
  reward: number;
  score: number;
  epsilon: number;
  loss: number;
  /** Fastest lap of this episode, for games that have laps. */
  bestLapMs?: number | null;
  /** Quickest full run of this episode. */
  bestRaceMs?: number | null;
}

/**
 * A model's own record on one setup.
 *
 * A lap on the oval and a lap on the mountain circuit are not the same lap, and
 * three laps and ten laps are not the same race — so a record is kept per track
 * and per distance instead of one global best that the easiest setup would own
 * forever.
 */
export interface SetupRecord {
  trackId: string;
  laps: number;
  bestLapMs: number | null;
  bestRaceMs: number | null;
  /** When this record was last improved. */
  at: number;
}

/** Key of a record inside `training.records`. */
export function recordKey(trackId: string, laps: number): string {
  return `${trackId}|${laps}`;
}

/** Everything needed to resume training or to race a model — minus the weights. */
export interface ModelMeta {
  id: string;
  name: string;
  /** The competitor who trained it — the team name in the championship. */
  owner: string;
  gameId: string;
  algorithm: AlgorithmId;
  /** Guards against loading a model trained on an older observation layout. */
  obsVersion: number;
  createdAt: number;
  updatedAt: number;
  arch: ModelArch;
  hyper: DqnHyper | GaHyper;
  /** The reward table this model was shaped by — its "personality". */
  rewards: RewardConfig;
  /** Environment config used during training (track, car count, collisions). */
  config: Record<string, unknown>;
  training: {
    episodes: number;
    envSteps: number;
    gradSteps: number;
    bestReward: number;
    lastReward: number;
    bestScore: number;
    /** Records on the setup it last trained on, for the model card. */
    bestLapMs?: number | null;
    bestRaceMs?: number | null;
    /** Every setup it has ever trained on, keyed by `recordKey`. */
    records?: Record<string, SetupRecord>;
    trainedMs: number;
    /** Downsampled to HISTORY_LIMIT points so the document stays small. */
    history: TrainingPoint[];
  };
}

export interface ModelRecord extends ModelMeta {
  weightsB64: string;
}

export interface ModelStore {
  readonly kind: 'local' | 'cloud';
  /** Human-readable description of where models are going. */
  readonly label: string;
  list(gameId?: string): Promise<ModelMeta[]>;
  load(id: string): Promise<ModelRecord | null>;
  save(rec: ModelRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Firestore caps a document at 1 MiB; keeping history short keeps us far below it. */
export const HISTORY_LIMIT = 240;

/**
 * Thin the history to at most HISTORY_LIMIT points, always keeping the first and
 * last so the chart still starts and ends where training did.
 */
export function downsampleHistory(points: TrainingPoint[]): TrainingPoint[] {
  if (points.length <= HISTORY_LIMIT) return points;
  const out: TrainingPoint[] = [];
  const stride = (points.length - 1) / (HISTORY_LIMIT - 1);
  for (let i = 0; i < HISTORY_LIMIT; i++) out.push(points[Math.round(i * stride)]);
  return out;
}

export function newModelId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function stripWeights(rec: ModelRecord): ModelMeta {
  const { weightsB64: _omit, ...meta } = rec;
  void _omit;
  return meta;
}
