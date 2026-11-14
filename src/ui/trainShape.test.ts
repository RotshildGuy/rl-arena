import { describe, expect, it } from 'vitest';
import { DEFAULT_HYPER, DqnAgent } from '../core/rl/dqn';
import { DEFAULT_GA_HYPER, GaLearner } from '../core/rl/ga';
import { DqnLearner } from '../core/rl/trainer';
import { getGame } from '../core/games/registry';
import { slotHyper } from './trainShape';

const draft = { hyper: { ...DEFAULT_HYPER, hidden: [64, 64] }, gaHyper: { ...DEFAULT_GA_HYPER, hidden: [64, 64] } };
const spec = getGame('racing').spec;

/** Weights as a model saved at this shape would hold them. */
function savedWeights(hidden: number[]): Float32Array {
  return new DqnAgent(spec.obsSize, spec.actions.length, { ...DEFAULT_HYPER, hidden }, 1).getWeights();
}

describe('slotHyper', () => {
  it('a new model takes the draft as it is', () => {
    expect(slotHyper(draft, null)).toEqual(draft);
    expect(slotHyper(draft, [])).toEqual(draft);
  });

  it('a saved model keeps its own network and the rest of the draft', () => {
    const s = slotHyper(draft, [48, 48]);
    expect(s.hyper.hidden).toEqual([48, 48]);
    expect(s.gaHyper.hidden).toEqual([48, 48]);
    expect(s.hyper.lr).toBe(draft.hyper.lr);
    expect(s.gaHyper.populationSize).toBe(draft.gaHyper.populationSize);
    // The draft itself is left alone, so the other models on the grid are not moved.
    expect(draft.hyper.hidden).toEqual([64, 64]);
  });

  it('a 48-48 model loads next to a 64-64 one (DQN)', () => {
    const small = savedWeights([48, 48]);
    expect(small.length).toBe(3993);
    // The bug: the draft's shape for every model.
    expect(
      () => new DqnLearner({ gameId: 'racing', hyper: draft.hyper, seed: 1, seatCount: 1, weights: small }),
    ).toThrow(/weight size mismatch: expected 6345, got 3993/);
    // The fix: the model's own shape, and it saves back what it loaded.
    const l = new DqnLearner({ gameId: 'racing', hyper: slotHyper(draft, [48, 48]).hyper, seed: 1, seatCount: 1, weights: small });
    expect(Array.from(l.getWeights())).toEqual(Array.from(small));
  });

  it('a 48-48 model loads next to a 64-64 one (GA), instead of silently starting over', () => {
    const small = savedWeights([48, 48]);
    const l = new GaLearner({
      gameId: 'racing',
      hyper: { ...slotHyper(draft, [48, 48]).gaHyper, populationSize: 4 },
      seed: 1,
      seatCount: 2,
      weights: small,
    });
    expect(Array.from(l.getWeights())).toEqual(Array.from(small));
  });
});
