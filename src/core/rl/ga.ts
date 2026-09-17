import { MLP } from '../nn/mlp';
import { getGame } from '../games/registry';
import type { Env, RewardConfig } from '../games/types';
import { mulberry32, randInt, randn, type Rng } from '../rng';
import type { EpisodeOutcome, Learner } from './learner';
import { TrainingSession } from './session';
import type { EpisodeStats, TrainerLike } from './trainerTypes';

export interface GaHyper {
  hidden: number[];
  populationSize: number;
  /** Share of the population copied unchanged into the next generation. */
  eliteFraction: number;
  /** Share of weights perturbed in a mutated child. */
  mutationRate: number;
  /** Standard deviation of the perturbation, annealed each generation. */
  mutationScale: number;
  mutationDecay: number;
  mutationFloor: number;
  crossover: boolean;
}

export const DEFAULT_GA_HYPER: GaHyper = {
  hidden: [64, 64],
  populationSize: 36,
  eliteFraction: 0.25,
  mutationRate: 0.15,
  mutationScale: 0.25,
  mutationDecay: 0.99,
  mutationFloor: 0.02,
  crossover: true,
};

export interface GaLearnerInit {
  gameId: string;
  hyper: Partial<GaHyper>;
  seed: number;
  /** How many seats of the shared environment this learner drives. */
  seatCount: number;
  weights?: Float32Array;
  envSteps?: number;
  episode?: number;
}

/**
 * Neuroevolution over a subset of the seats of a shared environment.
 *
 * No gradients at all: a whole population of networks is scored by playing, the
 * best survive, and the rest are their mutated children. Each step is far cheaper
 * than a DQN gradient step because the only cost is the simulation itself.
 *
 * The population is evaluated in heats of `seatCount` genomes at a time — one
 * shared episode is one heat — so genomes are always scored while racing each
 * other, and a model sharing the grid with other models simply runs narrower
 * heats.
 */
export class GaLearner implements Learner {
  readonly algorithm = 'ga' as const;
  readonly hyper: GaHyper;
  readonly seatCount: number;

  /** Generation index. */
  episode: number;
  envSteps = 0;

  private readonly rng: Rng;
  private readonly nActions: number;
  /** One net per seat; genome weights are swapped in per heat. */
  private readonly nets: MLP[];

  private population: Float32Array[] = [];
  private fitness: Float32Array;
  private scores: Float32Array;
  private evaluated: Uint8Array;

  private heat: number[] = [];
  private order: number[] = [];
  private cursor = 0;
  private genSteps = 0;
  private genBestLap: number | null = null;
  private genBestRace: number | null = null;

  private bestGenome: Float32Array;
  private bestFitness = -Infinity;
  private lastSpread = 0;
  private mutationScale: number;

  constructor(init: GaLearnerInit) {
    const game = getGame(init.gameId);
    this.hyper = { ...DEFAULT_GA_HYPER, ...init.hyper };
    this.seatCount = init.seatCount;
    this.nActions = game.spec.actions.length;
    this.episode = init.episode ?? 0;
    this.envSteps = init.envSteps ?? 0;
    this.rng = mulberry32(init.seed);
    this.mutationScale = this.hyper.mutationScale;

    const sizes = [game.spec.obsSize, ...this.hyper.hidden, this.nActions];
    this.nets = [];
    for (let i = 0; i < this.seatCount; i++) this.nets.push(new MLP({ sizes }));

    const pop = this.hyper.populationSize;
    this.fitness = new Float32Array(pop);
    this.scores = new Float32Array(pop);
    this.evaluated = new Uint8Array(pop);

    // Seed the population. When continuing a saved model the first generation is
    // that model plus mutations of it, so training resumes from what was learned.
    for (let i = 0; i < pop; i++) {
      const genome = new MLP({ sizes, seed: init.seed + i * 7919 }).getWeights();
      if (init.weights && init.weights.length === genome.length) {
        genome.set(init.weights);
        if (i > 0) this.mutate(genome);
      }
      this.population.push(genome);
    }
    this.bestGenome = Float32Array.from(this.population[0]);

    this.beginGeneration();
  }

  get gradSteps(): number {
    return this.episode;
  }

  get epsilon(): number {
    return this.mutationScale;
  }

  getWeights(): Float32Array {
    return this.bestGenome;
  }

  progressNote(): string {
    const total = Math.ceil(this.order.length / this.seatCount);
    const current = Math.min(total, Math.ceil(this.cursor / this.seatCount));
    return `מקצה ${current}/${total} בדור`;
  }

  beginEpisode(): void {
    this.heat = [];
    for (let s = 0; s < this.seatCount; s++) {
      // Wrap around when the population does not divide evenly into heats; a
      // genome racing twice simply gets a second chance at a better score.
      this.heat.push(this.order[(this.cursor + s) % this.order.length]);
    }
    this.cursor += this.seatCount;
    for (let s = 0; s < this.seatCount; s++) this.nets[s].setWeights(this.population[this.heat[s]]);
  }

  act(slot: number, obs: Float32Array): number {
    const q = this.nets[slot].predict(obs);
    let best = 0;
    for (let i = 1; i < this.nActions; i++) if (q[i] > q[best]) best = i;
    return best;
  }

  observe(): void {
    // Nothing is learned from a single transition; only the heat total counts.
    this.envSteps++;
  }

  afterStep(): void {}

  endEpisode(o: EpisodeOutcome): EpisodeStats | null {
    this.genSteps += o.steps;
    if (o.bestLapMs !== null && (this.genBestLap === null || o.bestLapMs < this.genBestLap)) {
      this.genBestLap = o.bestLapMs;
    }
    if (o.bestRaceMs !== null && (this.genBestRace === null || o.bestRaceMs < this.genBestRace)) {
      this.genBestRace = o.bestRaceMs;
    }

    for (let s = 0; s < this.seatCount; s++) {
      const g = this.heat[s];
      const r = o.seatRewards[s];
      if (!this.evaluated[g] || r > this.fitness[g]) {
        this.fitness[g] = r;
        this.scores[g] = o.seatScores[s];
      }
      this.evaluated[g] = 1;
    }

    // The generation is over only once every genome has raced; until then the
    // next shared episode is simply the next heat, which the session opens by
    // calling beginEpisode again.
    if (this.cursor < this.order.length) return null;

    const stats = this.evolve();
    this.beginGeneration();
    return stats;
  }

  private beginGeneration(): void {
    this.order = this.population.map((_, i) => i);
    for (let i = this.order.length - 1; i > 0; i--) {
      const j = randInt(this.rng, i + 1);
      const tmp = this.order[i];
      this.order[i] = this.order[j];
      this.order[j] = tmp;
    }
    this.cursor = 0;
    this.genSteps = 0;
    this.genBestLap = null;
    this.genBestRace = null;
    this.fitness.fill(0);
    this.scores.fill(0);
    this.evaluated.fill(0);
  }

  /** Rank the population, keep the elites, breed the rest, anneal the mutation scale. */
  private evolve(): EpisodeStats {
    const pop = this.hyper.populationSize;
    const ranked = this.population.map((_, i) => i).sort((a, b) => this.fitness[b] - this.fitness[a]);

    let sum = 0;
    let sumScore = 0;
    for (let i = 0; i < pop; i++) {
      sum += this.fitness[i];
      sumScore += this.scores[i];
    }
    const mean = sum / pop;
    let variance = 0;
    for (let i = 0; i < pop; i++) variance += (this.fitness[i] - mean) ** 2;
    this.lastSpread = Math.sqrt(variance / pop);

    const top = ranked[0];
    if (this.fitness[top] > this.bestFitness) {
      this.bestFitness = this.fitness[top];
      this.bestGenome = Float32Array.from(this.population[top]);
    }

    const nElite = Math.max(1, Math.round(pop * this.hyper.eliteFraction));
    const next: Float32Array[] = [];
    for (let i = 0; i < nElite; i++) next.push(Float32Array.from(this.population[ranked[i]]));

    while (next.length < pop) {
      const a = this.population[ranked[randInt(this.rng, nElite)]];
      let child: Float32Array;
      if (this.hyper.crossover) {
        const b = this.population[ranked[randInt(this.rng, nElite)]];
        child = new Float32Array(a.length);
        for (let k = 0; k < a.length; k++) child[k] = this.rng() < 0.5 ? a[k] : b[k];
      } else {
        child = Float32Array.from(a);
      }
      this.mutate(child);
      next.push(child);
    }

    this.population = next;
    this.mutationScale = Math.max(this.hyper.mutationFloor, this.mutationScale * this.hyper.mutationDecay);

    const stats: EpisodeStats = {
      episode: this.episode,
      bestLapMs: this.genBestLap,
      bestRaceMs: this.genBestRace,
      reward: mean,
      steps: this.genSteps,
      score: sumScore / pop,
      epsilon: this.mutationScale,
      loss: this.lastSpread,
      envSteps: this.envSteps,
      gradSteps: this.episode + 1,
    };
    this.episode++;
    return stats;
  }

  private mutate(genome: Float32Array): void {
    const rate = this.hyper.mutationRate;
    for (let k = 0; k < genome.length; k++) {
      if (this.rng() < rate) genome[k] += randn(this.rng) * this.mutationScale;
    }
  }
}

/** Single-model neuroevolution: one session, one learner, every seat. */
export class GaTrainer implements TrainerLike {
  readonly session: TrainingSession;
  readonly learner: GaLearner;
  readonly gameId: string;
  readonly algorithm = 'ga' as const;

  constructor(init: {
    gameId: string;
    config: Record<string, unknown>;
    rewards: RewardConfig;
    hyper: Partial<GaHyper>;
    seed: number;
    weights?: Float32Array;
    envSteps?: number;
    episode?: number;
  }) {
    this.gameId = init.gameId;
    let learner!: GaLearner;
    this.session = new TrainingSession({
      gameId: init.gameId,
      config: init.config,
      rewards: [init.rewards],
      seed: init.seed,
      makeLearner: (_slot, seats) => {
        learner = new GaLearner({ ...init, seatCount: seats.length });
        return learner;
      },
    });
    this.learner = learner;
  }

  get env(): Env<unknown> {
    return this.session.env;
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
    return this.learner.progressNote();
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
