import type { Env, RewardConfig } from '../games/types';
import { getGame } from '../games/registry';
import { DqnAgent, type DqnHyper } from './dqn';
import type { EpisodeOutcome, Learner } from './learner';
import { TrainingSession } from './session';
import type { EpisodeStats, TrainerLike } from './trainerTypes';

export interface LearnerInit {
  gameId: string;
  hyper: Partial<DqnHyper>;
  seed: number;
  /** How many seats of the shared environment this learner drives. */
  seatCount: number;
  /** Continue an existing model instead of starting from scratch. */
  weights?: Float32Array;
  envSteps?: number;
  gradSteps?: number;
  episode?: number;
}

/**
 * Double DQN over one or more seats of a shared environment.
 *
 * Every seat it holds is steered by the *same* network, so a model driving two
 * cars collects two transitions per simulation step and learns to handle traffic
 * as a side effect.
 */
export class DqnLearner implements Learner {
  readonly algorithm = 'dqn' as const;
  readonly agent: DqnAgent;
  readonly seatCount: number;

  episode: number;
  /** Exponential moving average, so the loss line is readable. */
  lossEma = 0;

  constructor(init: LearnerInit) {
    const game = getGame(init.gameId);
    this.seatCount = init.seatCount;
    this.episode = init.episode ?? 0;
    this.agent = new DqnAgent(game.spec.obsSize, game.spec.actions.length, init.hyper, init.seed);
    if (init.weights) this.agent.setWeights(init.weights);
    if (init.envSteps) this.agent.envSteps = init.envSteps;
    if (init.gradSteps) this.agent.gradSteps = init.gradSteps;
  }

  get envSteps(): number {
    return this.agent.envSteps;
  }

  get gradSteps(): number {
    return this.agent.gradSteps;
  }

  get epsilon(): number {
    return this.agent.epsilon;
  }

  beginEpisode(): void {}

  act(_slot: number, obs: Float32Array): number {
    return this.agent.act(obs);
  }

  observe(
    _slot: number,
    obs: Float32Array,
    action: number,
    reward: number,
    nextObs: Float32Array,
    done: boolean,
  ): void {
    this.agent.remember(obs, action, reward, nextObs, done);
  }

  afterStep(): void {
    const { trainEvery } = this.agent.hyper;
    for (let k = 0; k < trainEvery; k++) {
      const loss = this.agent.trainStep();
      if (loss !== null) this.lossEma = this.lossEma === 0 ? loss : this.lossEma * 0.99 + loss * 0.01;
    }
  }

  endEpisode(o: EpisodeOutcome): EpisodeStats {
    let reward = 0;
    let score = 0;
    for (let i = 0; i < this.seatCount; i++) {
      reward += o.seatRewards[i];
      score += o.seatScores[i];
    }
    const stats: EpisodeStats = {
      episode: this.episode,
      bestLapMs: o.bestLapMs,
      bestRaceMs: o.bestRaceMs,
      reward: reward / this.seatCount,
      steps: o.steps,
      score: score / this.seatCount,
      epsilon: this.agent.epsilon,
      loss: this.lossEma,
      envSteps: this.agent.envSteps,
      gradSteps: this.agent.gradSteps,
    };
    this.episode++;
    return stats;
  }

  getWeights(): Float32Array {
    return this.agent.getWeights();
  }

  progressNote(episodeSteps: number): string {
    return `צעד ${episodeSteps} באפיזודה`;
  }
}

export interface TrainerInit {
  gameId: string;
  config: Record<string, unknown>;
  rewards: RewardConfig;
  hyper: Partial<DqnHyper>;
  seed: number;
  weights?: Float32Array;
  envSteps?: number;
  gradSteps?: number;
  episode?: number;
}

/**
 * Single-model DQN training: one session, one learner, every seat.
 *
 * Kept as its own class because the offline scripts and the benchmarks drive it
 * directly, and because "one model, all the cars" deserves a name.
 */
export class Trainer implements TrainerLike {
  readonly session: TrainingSession;
  readonly learner: DqnLearner;
  readonly gameId: string;
  readonly algorithm = 'dqn' as const;

  constructor(init: TrainerInit) {
    this.gameId = init.gameId;
    let learner!: DqnLearner;
    this.session = new TrainingSession({
      gameId: init.gameId,
      config: init.config,
      rewards: [init.rewards],
      seed: init.seed,
      makeLearner: (_slot, seats) => {
        learner = new DqnLearner({ ...init, seatCount: seats.length });
        return learner;
      },
    });
    this.learner = learner;
  }

  get env(): Env<unknown> {
    return this.session.env;
  }

  get agent(): DqnAgent {
    return this.learner.agent;
  }

  get episode(): number {
    return this.learner.episode;
  }

  get envSteps(): number {
    return this.learner.envSteps;
  }

  get gradSteps(): number {
    return this.learner.gradSteps;
  }

  get epsilon(): number {
    return this.learner.epsilon;
  }

  getWeights(): Float32Array {
    return this.learner.getWeights();
  }

  progressNote(): string {
    return this.learner.progressNote(this.session.episodeSteps);
  }

  setRewards(rewards: RewardConfig): void {
    this.session.setRewards(0, rewards);
  }

  stepOnce(): EpisodeStats | null {
    const out = this.session.step();
    return out.length ? out[0].stats : null;
  }

  snapshot(): unknown {
    return this.session.snapshot();
  }
}
