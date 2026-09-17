import { getGame } from '../core/games/registry';
import type { RewardConfig } from '../core/games/types';
import type { DqnHyper } from '../core/rl/dqn';
import type { GaHyper } from '../core/rl/ga';
import type { AlgorithmId } from '../core/rl/algorithms';
import {
  downsampleHistory,
  getStore,
  newModelId,
  recordKey,
  type ModelRecord,
  type SetupRecord,
  type TrainingPoint,
} from '../storage';

export interface SaveArgs {
  id: string | null;
  name: string;
  owner: string;
  gameId: string;
  config: Record<string, unknown>;
  rewards: RewardConfig;
  algorithm: AlgorithmId;
  hyper: DqnHyper | GaHyper;
  /** The full history, including anything resumed from an earlier run. */
  history: TrainingPoint[];
  /**
   * Where this run started inside `history`. Only points after it were driven on
   * the current track and distance, so only they may set its record.
   */
  sessionStart?: number;
  /** Records the model already held, to merge the new run into. */
  priorRecords?: Record<string, SetupRecord>;
  weightsB64: string;
  envSteps: number;
  gradSteps: number;
  episodes: number;
  trainedMs: number;
  createdAt?: number;
}

/** The quickest of a list of times, ignoring gaps. */
function fastest(points: TrainingPoint[], pick: (p: TrainingPoint) => number | null | undefined): number | null {
  let out: number | null = null;
  for (const p of points) {
    const v = pick(p);
    if (v !== null && v !== undefined && isFinite(v) && (out === null || v < out)) out = v;
  }
  return out;
}

function quicker(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

export async function saveModel(args: SaveArgs): Promise<ModelRecord> {
  const spec = getGame(args.gameId).spec;
  const history = downsampleHistory(args.history);
  const rewards = history.map((p) => p.reward);
  const scores = history.map((p) => p.score);

  // Records come from the *full* history, not the downsampled copy: thinning the
  // chart must never lose the lap record it happened to drop. And only from this
  // run's points, because the earlier ones may have been driven somewhere else.
  const session = args.history.slice(args.sessionStart ?? 0);
  const key = recordKey(String(args.config.trackId ?? ''), Number(args.config.laps ?? 0));
  const prior = args.priorRecords?.[key];
  const bestLapMs = quicker(prior?.bestLapMs ?? null, fastest(session, (p) => p.bestLapMs));
  const bestRaceMs = quicker(prior?.bestRaceMs ?? null, fastest(session, (p) => p.bestRaceMs));
  const records: Record<string, SetupRecord> = { ...(args.priorRecords ?? {}) };
  if (bestLapMs !== null || bestRaceMs !== null) {
    records[key] = {
      trackId: String(args.config.trackId ?? ''),
      laps: Number(args.config.laps ?? 0),
      bestLapMs,
      bestRaceMs,
      at:
        bestLapMs !== (prior?.bestLapMs ?? null) || bestRaceMs !== (prior?.bestRaceMs ?? null)
          ? Date.now()
          : prior?.at ?? Date.now(),
    };
  }

  const rec: ModelRecord = {
    id: args.id ?? newModelId(),
    name: args.name.trim() || 'מודל ללא שם',
    owner: args.owner.trim() || 'ללא שם',
    gameId: args.gameId,
    algorithm: args.algorithm,
    obsVersion: spec.obsVersion,
    createdAt: args.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    arch: { obsSize: spec.obsSize, hidden: args.hyper.hidden, nActions: spec.actions.length },
    hyper: args.hyper,
    rewards: args.rewards,
    config: args.config,
    training: {
      episodes: args.episodes,
      envSteps: args.envSteps,
      gradSteps: args.gradSteps,
      bestReward: rewards.length ? Math.max(...rewards) : 0,
      lastReward: rewards.length ? rewards[rewards.length - 1] : 0,
      bestScore: scores.length ? Math.max(...scores) : 0,
      bestLapMs,
      bestRaceMs,
      records,
      trainedMs: args.trainedMs,
      history,
    },
    weightsB64: args.weightsB64,
  };

  const store = await getStore();
  await store.save(rec);
  return rec;
}
