import { MLP } from '../nn/mlp';
import { t } from '../../i18n/dict';
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
  /**
   * Standard deviation of the perturbation, annealed each generation - as a
   * share of each layer's own natural spread, so a nudge to the small output
   * layer is as gentle as one to a hidden layer.
   */
  mutationScale: number;
  mutationDecay: number;
  mutationFloor: number;
  /** Mixing two parents weight by weight. Off: two unrelated nets rarely line up, and the child is usually worse than both. */
  crossover: boolean;
  /** Races every genome runs per generation; its fitness is the mean, so one lucky grid slot cannot carry it. */
  racesPerGenome: number;
  /**
   * Judge a heat on its first this-many steps rather than the whole race; 0
   * for the whole race. About five laps: a ten-lap heat spent most of the
   * training time on laps that told the selection nothing new, and judging on
   * five gave about twice the generations and lap times within a few percent
   * of DQN's (three laps was quicker still, but learned too little of racing
   * in traffic; mutating harder on top of it made training collapse).
   */
  evalSteps: number;
}

/**
 * Season 3 retune. The old settings scored each genome on one race and kept
 * the best of any repeats, mutated with a fixed 0.25 everywhere and kept the
 * single luckiest score ever seen as the model - so it mostly selected for a
 * good grid slot, and lost to DQN by a wide margin.
 */
export const DEFAULT_GA_HYPER: GaHyper = {
  hidden: [64, 64],
  populationSize: 24,
  eliteFraction: 0.25,
  mutationRate: 0.15,
  mutationScale: 0.35,
  mutationDecay: 0.97,
  mutationFloor: 0.05,
  crossover: false,
  racesPerGenome: 2,
  evalSteps: 2400,
};

/**
 * What a saved GA model continues training with: its own network shape (the
 * weights only fit that) and today's defaults for everything else, so a model
 * trained on the old settings does not carry them into its next session.
 */
export function gaHyperForSaved(saved: Partial<GaHyper> | undefined, base: GaHyper = DEFAULT_GA_HYPER): GaHyper {
  return { ...base, ...(saved?.hidden ? { hidden: saved.hidden } : {}) };
}

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
 * The population is evaluated in heats of `seatCount` genomes at a time - one
 * shared episode is one heat - so genomes are always scored while racing each
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
  /** Total reward and race count per genome - this generation's races and, for an elite, every one before. */
  private rewardSum: Float64Array;
  private races: Int32Array;
  private scoreSum: Float64Array;
  /** Per weight: the spread of the layer it belongs to, which mutation noise is scaled by. */
  private readonly noiseScale: Float32Array;

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
    this.rewardSum = new Float64Array(pop);
    this.races = new Int32Array(pop);
    this.scoreSum = new Float64Array(pop);
    this.noiseScale = layerSpread(sizes);

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

  get episodeLimit(): number | undefined {
    return this.hyper.evalSteps > 0 ? this.hyper.evalSteps : undefined;
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
    return t().algorithms.gaNote(current, total);
  }

  beginEpisode(): void {
    this.heat = [];
    for (let s = 0; s < this.seatCount; s++) {
      // Wrap around when the races do not divide evenly into heats; a genome
      // racing once more just adds one more race to its mean.
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
      this.rewardSum[g] += o.seatRewards[s];
      this.scoreSum[g] += o.seatScores[s];
      this.races[g]++;
    }

    // The generation is over only once every genome has raced; until then the
    // next shared episode is simply the next heat, which the session opens by
    // calling beginEpisode again.
    if (this.cursor < this.order.length) return null;

    const stats = this.evolve();
    this.beginGeneration();
    return stats;
  }

  /**
   * Every genome races `racesPerGenome` times, each round of races in its own
   * shuffle - so its heats, rivals and grid slots differ from one race to the
   * next. Race totals are not reset here: `evolve` hands the elites theirs.
   */
  private beginGeneration(): void {
    this.order = [];
    const rounds = Math.max(1, Math.round(this.hyper.racesPerGenome));
    for (let r = 0; r < rounds; r++) {
      const round = this.population.map((_, i) => i);
      for (let i = round.length - 1; i > 0; i--) {
        const j = randInt(this.rng, i + 1);
        const tmp = round[i];
        round[i] = round[j];
        round[j] = tmp;
      }
      this.order.push(...round);
    }
    this.cursor = 0;
    this.genSteps = 0;
    this.genBestLap = null;
    this.genBestRace = null;
  }

  /** A genome's fitness: its mean reward over every race it has run. */
  private fitnessOf(g: number): number {
    return this.races[g] ? this.rewardSum[g] / this.races[g] : -Infinity;
  }

  /**
   * Rank the population by mean reward, keep the elites (with their race
   * history, so each generation re-checks them), breed the rest from the
   * elites by rank, and anneal the mutation scale.
   */
  private evolve(): EpisodeStats {
    const pop = this.hyper.populationSize;
    const fit = this.population.map((_, i) => this.fitnessOf(i));
    const ranked = this.population.map((_, i) => i).sort((a, b) => fit[b] - fit[a]);

    let sum = 0;
    let sumScore = 0;
    for (let i = 0; i < pop; i++) {
      sum += fit[i];
      sumScore += this.races[i] ? this.scoreSum[i] / this.races[i] : 0;
    }
    const mean = sum / pop;
    let variance = 0;
    for (let i = 0; i < pop; i++) variance += (fit[i] - mean) ** 2;
    this.lastSpread = Math.sqrt(variance / pop);

    // The model worth saving is the leader on the mean of several races, not
    // the highest single score ever seen: one lucky race is not a good driver.
    const top = ranked[0];
    this.bestFitness = fit[top];
    this.bestGenome = Float32Array.from(this.population[top]);

    const nElite = Math.max(1, Math.round(pop * this.hyper.eliteFraction));
    const next: Float32Array[] = [];
    const nextSum = new Float64Array(pop);
    const nextRaces = new Int32Array(pop);
    const nextScore = new Float64Array(pop);
    for (let i = 0; i < nElite; i++) {
      const g = ranked[i];
      next.push(Float32Array.from(this.population[g]));
      nextSum[i] = this.rewardSum[g];
      nextRaces[i] = this.races[g];
      nextScore[i] = this.scoreSum[g];
    }

    // Parents by rank: the leader is picked nElite times as often as the last elite.
    const totalWeight = (nElite * (nElite + 1)) / 2;
    const pickParent = (): Float32Array => {
      let r = this.rng() * totalWeight;
      for (let i = 0; i < nElite; i++) {
        r -= nElite - i;
        if (r < 0) return this.population[ranked[i]];
      }
      return this.population[ranked[nElite - 1]];
    };

    while (next.length < pop) {
      const a = pickParent();
      let child: Float32Array;
      if (this.hyper.crossover) {
        const b = pickParent();
        child = new Float32Array(a.length);
        for (let k = 0; k < a.length; k++) child[k] = this.rng() < 0.5 ? a[k] : b[k];
      } else {
        child = Float32Array.from(a);
      }
      this.mutate(child);
      next.push(child);
    }

    this.population = next;
    this.rewardSum = nextSum;
    this.races = nextRaces;
    this.scoreSum = nextScore;
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

  /** For tests: the genomes racing in the current heat, by seat. */
  get heatGenomes(): readonly number[] {
    return this.heat;
  }

  /** For tests: each genome's mean reward and race count. */
  standings(): Array<{ fitness: number; races: number }> {
    return this.population.map((_, i) => ({ fitness: this.fitnessOf(i), races: this.races[i] }));
  }

  /** The saved model's fitness: the leader's mean over its races. */
  get savedFitness(): number {
    return this.bestFitness;
  }

  private mutate(genome: Float32Array): void {
    const rate = this.hyper.mutationRate;
    for (let k = 0; k < genome.length; k++) {
      if (this.rng() < rate) genome[k] += randn(this.rng) * this.mutationScale * this.noiseScale[k];
    }
  }
}

/**
 * Per weight, in `MLP.getWeights` order (each layer's weights, then its
 * biases): the natural spread of that layer - He for the ReLU layers, and
 * 1/sqrt(fan-in) for the linear head. The head starts ten times tighter for
 * DQN's sake, but evolution has to be able to move it.
 */
function layerSpread(sizes: number[]): Float32Array {
  let n = 0;
  for (let l = 0; l + 1 < sizes.length; l++) n += sizes[l] * sizes[l + 1] + sizes[l + 1];
  const out = new Float32Array(n);
  let off = 0;
  for (let l = 0; l + 1 < sizes.length; l++) {
    const nIn = sizes[l];
    const count = nIn * sizes[l + 1] + sizes[l + 1];
    const isLast = l + 2 === sizes.length;
    out.fill(isLast ? Math.sqrt(1 / nIn) : Math.sqrt(2 / nIn), off, off + count);
    off += count;
  }
  return out;
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
