/**
 * Abstraction over the neural-net implementation. `MLP` is the pure-TS backend;
 * a TensorFlow.js backend can be dropped in later without touching the RL code.
 */
export interface Net {
  readonly sizes: readonly number[];
  /** Number of trainable scalars — matches `getWeights().length`. */
  readonly paramCount: number;

  /** Single-sample forward pass. Returns a view valid until the next call. */
  predict(x: Float32Array, out?: Float32Array): Float32Array;

  /** Batched forward. `x` is `batch * sizes[0]` row-major. Returns `batch * outSize`. */
  forwardBatch(x: Float32Array, batch: number): Float32Array;

  /**
   * Backprop `dOut` (dLoss/dOutputLogits, `batch * outSize`) and accumulate
   * gradients. Must follow a `forwardBatch` with the same batch size.
   */
  backwardBatch(dOut: Float32Array, batch: number): void;

  /** Apply the accumulated gradients (Adam) and zero them. */
  step(): void;

  zeroGrads(): void;

  getWeights(): Float32Array;
  setWeights(w: Float32Array): void;

  /** Fresh net with identical architecture and weights (used for the target net). */
  clone(): Net;
  /** Copy weights from another net of identical architecture. */
  copyFrom(other: Net): void;

  setLearningRate(lr: number): void;
}
