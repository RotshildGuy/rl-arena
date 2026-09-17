import { randInt, type Rng } from '../rng';

export interface Batch {
  obs: Float32Array;
  nextObs: Float32Array;
  actions: Int32Array;
  rewards: Float32Array;
  dones: Uint8Array;
  size: number;
}

/**
 * Fixed-capacity ring buffer over flat typed arrays. An array of transition
 * objects would blow up the heap at 100k entries; this keeps it to a handful of
 * contiguous allocations.
 */
export class ReplayBuffer {
  readonly capacity: number;
  readonly obsSize: number;

  private readonly obs: Float32Array;
  private readonly nextObs: Float32Array;
  private readonly actions: Int32Array;
  private readonly rewards: Float32Array;
  private readonly dones: Uint8Array;

  private head = 0;
  private count = 0;

  constructor(capacity: number, obsSize: number) {
    this.capacity = capacity;
    this.obsSize = obsSize;
    this.obs = new Float32Array(capacity * obsSize);
    this.nextObs = new Float32Array(capacity * obsSize);
    this.actions = new Int32Array(capacity);
    this.rewards = new Float32Array(capacity);
    this.dones = new Uint8Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  push(obs: Float32Array, action: number, reward: number, nextObs: Float32Array, done: boolean): void {
    const off = this.head * this.obsSize;
    this.obs.set(obs, off);
    this.nextObs.set(nextObs, off);
    this.actions[this.head] = action;
    this.rewards[this.head] = reward;
    this.dones[this.head] = done ? 1 : 0;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** Allocate a reusable destination for sample(). */
  makeBatch(size: number): Batch {
    return {
      obs: new Float32Array(size * this.obsSize),
      nextObs: new Float32Array(size * this.obsSize),
      actions: new Int32Array(size),
      rewards: new Float32Array(size),
      dones: new Uint8Array(size),
      size,
    };
  }

  /** Uniform sampling with replacement into a preallocated batch. */
  sample(batch: Batch, rng: Rng): void {
    const n = this.obsSize;
    for (let i = 0; i < batch.size; i++) {
      const j = randInt(rng, this.count);
      batch.obs.set(this.obs.subarray(j * n, j * n + n), i * n);
      batch.nextObs.set(this.nextObs.subarray(j * n, j * n + n), i * n);
      batch.actions[i] = this.actions[j];
      batch.rewards[i] = this.rewards[j];
      batch.dones[i] = this.dones[j];
    }
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }
}
