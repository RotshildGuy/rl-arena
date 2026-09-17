import { MLP } from '../nn/mlp';
import type { Net } from '../nn/net';
import { mulberry32, randInt, type Rng } from '../rng';
import { ReplayBuffer, type Batch } from './replayBuffer';

export interface DqnHyper {
  hidden: number[];
  lr: number;
  gamma: number;
  batchSize: number;
  bufferSize: number;
  /** Copy online -> target every N gradient steps. */
  targetSync: number;
  epsStart: number;
  epsEnd: number;
  epsDecaySteps: number;
  /** Transitions collected before learning begins. */
  warmup: number;
  /** Gradient steps per environment step. */
  trainEvery: number;
  doubleDqn: boolean;
  huberDelta: number;
}

export const DEFAULT_HYPER: DqnHyper = {
  hidden: [64, 64],
  lr: 5e-4,
  gamma: 0.99,
  batchSize: 32,
  bufferSize: 100_000,
  targetSync: 1000,
  epsStart: 1.0,
  epsEnd: 0.05,
  epsDecaySteps: 150_000,
  warmup: 1000,
  trainEvery: 1,
  doubleDqn: true,
  huberDelta: 1.0,
};

/** Double DQN with a replay buffer, a target network and Huber loss. */
export class DqnAgent {
  readonly obsSize: number;
  readonly nActions: number;
  readonly hyper: DqnHyper;

  readonly online: Net;
  readonly target: Net;
  readonly buffer: ReplayBuffer;

  /** Environment steps seen — drives the epsilon schedule. */
  envSteps = 0;
  /** Gradient steps taken. */
  gradSteps = 0;

  private readonly rng: Rng;
  private readonly batch: Batch;
  private readonly qNextTarget: Float32Array;
  private readonly qNextOnline: Float32Array;
  private readonly dOut: Float32Array;

  constructor(obsSize: number, nActions: number, hyper: Partial<DqnHyper> = {}, seed = 1) {
    this.obsSize = obsSize;
    this.nActions = nActions;
    this.hyper = { ...DEFAULT_HYPER, ...hyper };
    const sizes = [obsSize, ...this.hyper.hidden, nActions];
    this.online = new MLP({ sizes, lr: this.hyper.lr, seed });
    this.target = new MLP({ sizes, lr: this.hyper.lr, seed });
    this.target.copyFrom(this.online);
    this.buffer = new ReplayBuffer(this.hyper.bufferSize, obsSize);
    this.rng = mulberry32(seed ^ 0x9e3779b9);
    this.batch = this.buffer.makeBatch(this.hyper.batchSize);
    this.qNextTarget = new Float32Array(this.hyper.batchSize * nActions);
    this.qNextOnline = new Float32Array(this.hyper.batchSize * nActions);
    this.dOut = new Float32Array(this.hyper.batchSize * nActions);
  }

  get epsilon(): number {
    const { epsStart, epsEnd, epsDecaySteps } = this.hyper;
    const t = Math.min(1, this.envSteps / Math.max(1, epsDecaySteps));
    return epsStart + (epsEnd - epsStart) * t;
  }

  /** Epsilon-greedy action. Pass greedy=true for evaluation and for race mode. */
  act(obs: Float32Array, greedy = false): number {
    if (!greedy && this.rng() < this.epsilon) return randInt(this.rng, this.nActions);
    return this.actGreedy(obs);
  }

  actGreedy(obs: Float32Array): number {
    const q = this.online.predict(obs);
    let best = 0;
    let bestV = q[0];
    for (let i = 1; i < this.nActions; i++) {
      if (q[i] > bestV) {
        bestV = q[i];
        best = i;
      }
    }
    return best;
  }

  remember(obs: Float32Array, action: number, reward: number, nextObs: Float32Array, done: boolean): void {
    this.buffer.push(obs, action, reward, nextObs, done);
    this.envSteps++;
  }

  get canTrain(): boolean {
    return this.buffer.size >= Math.max(this.hyper.batchSize, this.hyper.warmup);
  }

  /** One gradient step. Returns the mean Huber loss, or null if still warming up. */
  trainStep(): number | null {
    if (!this.canTrain) return null;
    const { batchSize, gamma, doubleDqn, huberDelta } = this.hyper;
    const nA = this.nActions;
    const b = this.batch;
    this.buffer.sample(b, this.rng);

    // Forward passes on nextObs first: forwardBatch reuses internal buffers, so
    // the online pass on `obs` must be the last one before backwardBatch.
    if (doubleDqn) {
      this.qNextOnline.set(this.online.forwardBatch(b.nextObs, batchSize).subarray(0, batchSize * nA));
    }
    this.qNextTarget.set(this.target.forwardBatch(b.nextObs, batchSize).subarray(0, batchSize * nA));

    const qCur = this.online.forwardBatch(b.obs, batchSize);

    this.dOut.fill(0);
    let lossSum = 0;
    for (let i = 0; i < batchSize; i++) {
      const off = i * nA;
      let bootstrap = 0;
      if (!b.dones[i]) {
        if (doubleDqn) {
          let arg = 0;
          let bestV = this.qNextOnline[off];
          for (let k = 1; k < nA; k++) {
            if (this.qNextOnline[off + k] > bestV) {
              bestV = this.qNextOnline[off + k];
              arg = k;
            }
          }
          bootstrap = this.qNextTarget[off + arg];
        } else {
          let bestV = this.qNextTarget[off];
          for (let k = 1; k < nA; k++) bestV = Math.max(bestV, this.qNextTarget[off + k]);
          bootstrap = bestV;
        }
      }
      const targetQ = b.rewards[i] + gamma * bootstrap;
      const a = b.actions[i];
      const err = qCur[off + a] - targetQ;
      const absErr = Math.abs(err);
      lossSum += absErr <= huberDelta ? 0.5 * err * err : huberDelta * (absErr - 0.5 * huberDelta);
      // Huber gradient, averaged over the batch. Only the taken action gets one.
      const clipped = Math.max(-huberDelta, Math.min(huberDelta, err));
      this.dOut[off + a] = clipped / batchSize;
    }

    this.online.backwardBatch(this.dOut, batchSize);
    this.online.step();
    this.gradSteps++;
    if (this.gradSteps % this.hyper.targetSync === 0) this.target.copyFrom(this.online);

    return lossSum / batchSize;
  }

  getWeights(): Float32Array {
    return this.online.getWeights();
  }

  setWeights(w: Float32Array): void {
    this.online.setWeights(w);
    this.target.copyFrom(this.online);
  }
}
