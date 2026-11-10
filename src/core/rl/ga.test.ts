import { describe, expect, it } from 'vitest';
import { DEFAULT_GA_HYPER, GaLearner, GaTrainer, gaHyperForSaved } from './ga';
import { getGame } from '../games/registry';
import { defaultRewards } from '../games/types';

/**
 * Drives a learner through whole generations with made-up race results: the
 * reward a genome gets in its n-th race of a generation is `reward(g, n)`.
 */
function runGeneration(l: GaLearner, reward: (g: number, n: number) => number): void {
  const seen = new Map<number, number>();
  for (;;) {
    l.beginEpisode();
    const heat = l.heatGenomes;
    const seatRewards = new Float32Array(heat.length);
    heat.forEach((g, s) => {
      const n = seen.get(g) ?? 0;
      seen.set(g, n + 1);
      seatRewards[s] = reward(g, n);
    });
    const stats = l.endEpisode({
      seatRewards,
      seatScores: new Float32Array(heat.length),
      bestLapMs: null,
      bestRaceMs: null,
      steps: 10,
    });
    if (stats) return;
  }
}

const learner = (hyper = {}) =>
  new GaLearner({ gameId: 'racing', hyper: { hidden: [8], populationSize: 8, eliteFraction: 0.25, ...hyper }, seed: 3, seatCount: 4 });

describe('GA', () => {
  it('scores each genome on the mean of its races, not its best one', () => {
    const l = learner();
    // Genome 0 has one great race and one awful one; genome 1 is steady.
    runGeneration(l, (g, n) => (g === 0 ? (n === 0 ? 100 : -100) : g === 1 ? 10 : 0));
    const elites = l.standings().filter((s) => s.races > 0);
    expect(elites.map((e) => e.races)).toEqual([2, 2]);
    expect(elites[0].fitness).toBeCloseTo(10);
    expect(l.savedFitness).toBeCloseTo(10);
  });

  it('carries the elites over with their races, and races them again', () => {
    const l = learner();
    runGeneration(l, (g) => g);
    runGeneration(l, () => 0);
    // The two elites of generation one ran 2 races there and 2 more here;
    // whoever survived generation two with that history shows 4.
    expect(Math.max(...l.standings().map((s) => s.races))).toBe(4);
  });

  it('a saved model continues on the current settings, in its own network shape', () => {
    const old = { hidden: [48, 48], populationSize: 36, mutationScale: 0.25, crossover: true, mutationDecay: 0.99 };
    const h = gaHyperForSaved(old);
    expect(h.hidden).toEqual([48, 48]);
    expect(h.populationSize).toBe(DEFAULT_GA_HYPER.populationSize);
    expect(h.mutationScale).toBe(DEFAULT_GA_HYPER.mutationScale);
    expect(h.crossover).toBe(false);
    expect(h.racesPerGenome).toBe(2);
  });

  it('judges a heat on its first evalSteps steps, then starts the next one', () => {
    const game = getGame('racing');
    const t = new GaTrainer({
      gameId: 'racing',
      config: { ...game.defaultConfig(), nCars: 4, laps: 10, maxSteps: 9600 },
      rewards: defaultRewards(game.spec),
      hyper: { hidden: [8], populationSize: 8, evalSteps: 50 },
      seed: 1,
    });
    let longest = 0;
    for (let i = 0; i < 400; i++) {
      t.stepOnce();
      longest = Math.max(longest, t.session.episodeSteps);
    }
    expect(longest).toBeLessThanOrEqual(50);
  });
});
