import type { Net } from './net';
import { mulberry32, randn, type Rng } from '../rng';

export interface MLPConfig {
  /** [inputSize, ...hiddenSizes, outputSize] */
  sizes: number[];
  seed?: number;
  lr?: number;
  beta1?: number;
  beta2?: number;
  eps?: number;
  /** Global-norm gradient clipping. 0 disables. */
  maxGradNorm?: number;
}

/**
 * Dense MLP with ReLU hidden layers and a linear output layer, trained with Adam.
 *
 * Everything lives in flat Float32Arrays. Weight matrix W[l] has shape
 * (nOut x nIn) row-major, so W[l][o * nIn + i].
 *
 * ReLU lets us skip storing pre-activations: a = max(0, z) means a > 0 iff
 * z > 0, which is all backprop needs.
 */
export class MLP implements Net {
  readonly sizes: readonly number[];
  readonly paramCount: number;

  private readonly nLayers: number;
  private readonly W: Float32Array[];
  private readonly b: Float32Array[];
  private readonly gW: Float32Array[];
  private readonly gB: Float32Array[];
  private readonly mW: Float32Array[];
  private readonly vW: Float32Array[];
  private readonly mB: Float32Array[];
  private readonly vB: Float32Array[];

  /** Activations per layer, capacity * sizes[l]. a[0] is the input. */
  private a: Float32Array[] = [];
  /** Backprop deltas per layer boundary, capacity * sizes[l]. */
  private d: Float32Array[] = [];
  private capacity = 0;

  private lr: number;
  private readonly beta1: number;
  private readonly beta2: number;
  private readonly eps: number;
  private readonly maxGradNorm: number;
  private t = 0;

  private readonly singleOut: Float32Array;

  constructor(cfg: MLPConfig) {
    if (cfg.sizes.length < 2) throw new Error('MLP needs at least an input and an output layer');
    this.sizes = cfg.sizes.slice();
    this.nLayers = cfg.sizes.length - 1;
    this.lr = cfg.lr ?? 5e-4;
    this.beta1 = cfg.beta1 ?? 0.9;
    this.beta2 = cfg.beta2 ?? 0.999;
    this.eps = cfg.eps ?? 1e-8;
    this.maxGradNorm = cfg.maxGradNorm ?? 10;

    const rng = mulberry32(cfg.seed ?? 1234);
    this.W = [];
    this.b = [];
    this.gW = [];
    this.gB = [];
    this.mW = [];
    this.vW = [];
    this.mB = [];
    this.vB = [];

    let params = 0;
    for (let l = 0; l < this.nLayers; l++) {
      const nIn = cfg.sizes[l];
      const nOut = cfg.sizes[l + 1];
      const isLast = l === this.nLayers - 1;
      this.W.push(initWeights(nIn, nOut, isLast, rng));
      this.b.push(new Float32Array(nOut));
      this.gW.push(new Float32Array(nIn * nOut));
      this.gB.push(new Float32Array(nOut));
      this.mW.push(new Float32Array(nIn * nOut));
      this.vW.push(new Float32Array(nIn * nOut));
      this.mB.push(new Float32Array(nOut));
      this.vB.push(new Float32Array(nOut));
      params += nIn * nOut + nOut;
    }
    this.paramCount = params;
    this.singleOut = new Float32Array(cfg.sizes[this.nLayers]);
    this.ensureCapacity(1);
  }

  private ensureCapacity(batch: number): void {
    if (batch <= this.capacity) return;
    this.a = this.sizes.map((n) => new Float32Array(batch * n));
    this.d = this.sizes.map((n) => new Float32Array(batch * n));
    this.capacity = batch;
  }

  predict(x: Float32Array, out?: Float32Array): Float32Array {
    const y = this.forwardBatch(x, 1);
    const dst = out ?? this.singleOut;
    dst.set(y.subarray(0, this.sizes[this.nLayers]));
    return dst;
  }

  forwardBatch(x: Float32Array, batch: number): Float32Array {
    this.ensureCapacity(batch);
    const inSize = this.sizes[0];
    this.a[0].set(x.subarray(0, batch * inSize));

    for (let l = 0; l < this.nLayers; l++) {
      const nIn = this.sizes[l];
      const nOut = this.sizes[l + 1];
      const W = this.W[l];
      const bias = this.b[l];
      const src = this.a[l];
      const dst = this.a[l + 1];
      const linear = l === this.nLayers - 1;

      for (let bi = 0; bi < batch; bi++) {
        const sOff = bi * nIn;
        const dOff = bi * nOut;
        for (let o = 0; o < nOut; o++) {
          const wOff = o * nIn;
          let s = bias[o];
          for (let i = 0; i < nIn; i++) s += W[wOff + i] * src[sOff + i];
          dst[dOff + o] = linear ? s : s > 0 ? s : 0;
        }
      }
    }
    return this.a[this.nLayers];
  }

  backwardBatch(dOut: Float32Array, batch: number): void {
    if (batch > this.capacity) throw new Error('backwardBatch without a matching forwardBatch');
    const outSize = this.sizes[this.nLayers];
    this.d[this.nLayers].set(dOut.subarray(0, batch * outSize));

    for (let l = this.nLayers - 1; l >= 0; l--) {
      const nIn = this.sizes[l];
      const nOut = this.sizes[l + 1];
      const W = this.W[l];
      const gW = this.gW[l];
      const gB = this.gB[l];
      const aIn = this.a[l];
      const dz = this.d[l + 1];
      const dPrev = this.d[l];

      if (l > 0) dPrev.fill(0, 0, batch * nIn);

      for (let bi = 0; bi < batch; bi++) {
        const zOff = bi * nOut;
        const aOff = bi * nIn;
        for (let o = 0; o < nOut; o++) {
          const g = dz[zOff + o];
          if (g === 0) continue;
          gB[o] += g;
          const wOff = o * nIn;
          for (let i = 0; i < nIn; i++) gW[wOff + i] += g * aIn[aOff + i];
          if (l > 0) {
            for (let i = 0; i < nIn; i++) dPrev[aOff + i] += g * W[wOff + i];
          }
        }
      }

      // ReLU derivative of the layer below; a[l] is post-ReLU whenever l > 0.
      if (l > 0) {
        const n = batch * nIn;
        for (let k = 0; k < n; k++) if (aIn[k] <= 0) dPrev[k] = 0;
      }
    }
  }

  step(): void {
    this.t++;
    let scale = 1;
    if (this.maxGradNorm > 0) {
      let sq = 0;
      for (let l = 0; l < this.nLayers; l++) {
        const gW = this.gW[l];
        const gB = this.gB[l];
        for (let k = 0; k < gW.length; k++) sq += gW[k] * gW[k];
        for (let k = 0; k < gB.length; k++) sq += gB[k] * gB[k];
      }
      const norm = Math.sqrt(sq);
      if (norm > this.maxGradNorm) scale = this.maxGradNorm / norm;
    }

    const bc1 = 1 - Math.pow(this.beta1, this.t);
    const bc2 = 1 - Math.pow(this.beta2, this.t);
    const args = [this.lr, this.beta1, this.beta2, this.eps, bc1, bc2, scale] as const;

    for (let l = 0; l < this.nLayers; l++) {
      adam(this.W[l], this.gW[l], this.mW[l], this.vW[l], ...args);
      adam(this.b[l], this.gB[l], this.mB[l], this.vB[l], ...args);
    }
    this.zeroGrads();
  }

  zeroGrads(): void {
    for (let l = 0; l < this.nLayers; l++) {
      this.gW[l].fill(0);
      this.gB[l].fill(0);
    }
  }

  getWeights(): Float32Array {
    const out = new Float32Array(this.paramCount);
    let off = 0;
    for (let l = 0; l < this.nLayers; l++) {
      out.set(this.W[l], off);
      off += this.W[l].length;
      out.set(this.b[l], off);
      off += this.b[l].length;
    }
    return out;
  }

  /** Accumulated gradients in the same flat layout as getWeights(). For gradient checking. */
  getGradients(): Float32Array {
    const out = new Float32Array(this.paramCount);
    let off = 0;
    for (let l = 0; l < this.nLayers; l++) {
      out.set(this.gW[l], off);
      off += this.gW[l].length;
      out.set(this.gB[l], off);
      off += this.gB[l].length;
    }
    return out;
  }

  setWeights(w: Float32Array): void {
    if (w.length !== this.paramCount) {
      throw new Error('weight size mismatch: expected ' + this.paramCount + ', got ' + w.length);
    }
    let off = 0;
    for (let l = 0; l < this.nLayers; l++) {
      this.W[l].set(w.subarray(off, off + this.W[l].length));
      off += this.W[l].length;
      this.b[l].set(w.subarray(off, off + this.b[l].length));
      off += this.b[l].length;
    }
  }

  clone(): MLP {
    const copy = new MLP({
      sizes: this.sizes.slice(),
      lr: this.lr,
      beta1: this.beta1,
      beta2: this.beta2,
      eps: this.eps,
      maxGradNorm: this.maxGradNorm,
    });
    copy.setWeights(this.getWeights());
    return copy;
  }

  copyFrom(other: Net): void {
    this.setWeights(other.getWeights());
  }

  setLearningRate(lr: number): void {
    this.lr = lr;
  }
}

/** He init for ReLU layers; a tighter spread on the linear head keeps early Q-values tame. */
function initWeights(nIn: number, nOut: number, isLast: boolean, rng: Rng): Float32Array {
  const w = new Float32Array(nIn * nOut);
  const std = isLast ? Math.sqrt(1 / nIn) * 0.1 : Math.sqrt(2 / nIn);
  for (let k = 0; k < w.length; k++) w[k] = randn(rng) * std;
  return w;
}

function adam(
  p: Float32Array,
  g: Float32Array,
  m: Float32Array,
  v: Float32Array,
  lr: number,
  b1: number,
  b2: number,
  eps: number,
  bc1: number,
  bc2: number,
  scale: number,
): void {
  for (let k = 0; k < p.length; k++) {
    const grad = g[k] * scale;
    const mk = b1 * m[k] + (1 - b1) * grad;
    const vk = b2 * v[k] + (1 - b2) * grad * grad;
    m[k] = mk;
    v[k] = vk;
    p[k] -= (lr * (mk / bc1)) / (Math.sqrt(vk / bc2) + eps);
  }
}
