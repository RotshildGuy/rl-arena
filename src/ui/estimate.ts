import { DqnAgent, type DqnHyper } from '../core/rl/dqn';
import { GaTrainer, type GaHyper } from '../core/rl/ga';
import { getGame } from '../core/games/registry';
import { defaultRewards } from '../core/games/types';
import { mulberry32, randInt } from '../core/rng';
import type { AlgorithmId } from '../core/rl/algorithms';

export interface TimeEstimate {
  /** Seconds until the model is competent, on *this* device. */
  seconds: number;
  /** The measured throughput the estimate is based on. */
  rate: number;
  rateLabel: string;
}

/**
 * Estimate training time by actually running the configured algorithm briefly.
 *
 * A phone is 3-5x slower than a desktop and the gap is not predictable from the
 * user agent, so measure rather than guess. Both paths are capped at a few
 * hundred milliseconds.
 */
export function estimateTraining(
  gameId: string,
  algorithm: AlgorithmId,
  config: Record<string, unknown>,
  hyper: DqnHyper,
  gaHyper: GaHyper,
): TimeEstimate {
  const game = getGame(gameId);
  return algorithm === 'ga'
    ? estimateGa(gameId, config, gaHyper, game.effort.gaEnvSteps)
    : estimateDqn(game.spec.obsSize, game.spec.actions.length, hyper, game.effort.dqnGradSteps);
}

function estimateDqn(obsSize: number, nActions: number, hyper: DqnHyper, target: number): TimeEstimate {
  // The gradient step is ~100% of DQN's cost (see scripts/bench.ts), so timing it
  // alone is enough — no environment needed.
  const agent = new DqnAgent(obsSize, nActions, { ...hyper, warmup: 0, bufferSize: 4096 }, 1);
  const rng = mulberry32(7);
  const obs = new Float32Array(obsSize);
  for (let i = 0; i < 512; i++) {
    for (let k = 0; k < obsSize; k++) obs[k] = rng() * 2 - 1;
    agent.remember(obs, randInt(rng, nActions), rng(), obs, rng() < 0.02);
  }

  agent.trainStep(); // warm the JIT before measuring
  const t0 = performance.now();
  let steps = 0;
  while (performance.now() - t0 < 220) {
    agent.trainStep();
    steps++;
  }
  const rate = steps / ((performance.now() - t0) / 1000);
  return { seconds: target / rate, rate, rateLabel: 'צעדי אימון לשנייה' };
}

function estimateGa(
  gameId: string,
  config: Record<string, unknown>,
  gaHyper: GaHyper,
  target: number,
): TimeEstimate {
  const game = getGame(gameId);
  const trainer = new GaTrainer({
    gameId,
    config,
    rewards: defaultRewards(game.spec),
    // A small population keeps the probe cheap; throughput per step is unaffected.
    hyper: { ...gaHyper, populationSize: Math.min(gaHyper.populationSize, 8) },
    seed: 5,
  });

  for (let i = 0; i < 200; i++) trainer.stepOnce();
  const before = trainer.envSteps;
  const t0 = performance.now();
  while (performance.now() - t0 < 220) {
    for (let i = 0; i < 50; i++) trainer.stepOnce();
  }
  const rate = (trainer.envSteps - before) / ((performance.now() - t0) / 1000);
  return { seconds: target / rate, rate, rateLabel: 'צעדי סביבה לשנייה' };
}

export function formatEstimate(seconds: number): string {
  if (seconds < 90) return 'פחות מדקה וחצי';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `בערך ${minutes} דקות`;
  const hours = (minutes / 60).toFixed(1).replace('.0', '');
  return `בערך ${hours} שעות`;
}
