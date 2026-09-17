import { MLP } from '../nn/mlp';
import { decodeWeights } from '../nn/serialize';

/**
 * Inference-only wrapper around a trained network.
 *
 * Race mode loads several models at once; instantiating a full DqnAgent for each
 * would allocate a 100k-transition replay buffer per opponent for nothing.
 */
export class Policy {
  readonly nActions: number;
  private readonly net: MLP;

  constructor(obsSize: number, hidden: number[], nActions: number, weights: Float32Array) {
    this.nActions = nActions;
    this.net = new MLP({ sizes: [obsSize, ...hidden, nActions] });
    this.net.setWeights(weights);
  }

  static fromBase64(obsSize: number, hidden: number[], nActions: number, b64: string): Policy {
    return new Policy(obsSize, hidden, nActions, decodeWeights(b64));
  }

  act(obs: Float32Array): number {
    const q = this.net.predict(obs);
    let best = 0;
    for (let i = 1; i < this.nActions; i++) if (q[i] > q[best]) best = i;
    return best;
  }
}
