import { describe, expect, it } from 'vitest';
import { MLP } from './mlp';
import { decodeWeights, encodeWeights, base64ToBytes, bytesToBase64 } from './serialize';
import { mulberry32 } from '../rng';

/** Mean squared error over a batch, halved so its gradient is `out - y`. */
function mse(out: Float32Array, y: Float32Array, batch: number): number {
  let s = 0;
  for (let i = 0; i < y.length; i++) s += 0.5 * (out[i] - y[i]) ** 2;
  return s / batch;
}

describe('MLP', () => {
  it('backprop matches finite differences', () => {
    const net = new MLP({ sizes: [4, 6, 5, 3], seed: 7, maxGradNorm: 0 });
    const rng = mulberry32(99);
    const batch = 5;
    const x = Float32Array.from({ length: batch * 4 }, () => rng() * 2 - 1);
    const y = Float32Array.from({ length: batch * 3 }, () => rng() * 2 - 1);

    const w0 = net.getWeights();
    const out = net.forwardBatch(x, batch);
    const dOut = Float32Array.from(out, (o, i) => (o - y[i]) / batch);
    net.zeroGrads();
    net.backwardBatch(dOut, batch);
    const analytic = net.getGradients();

    const lossAt = (w: Float32Array) => {
      net.setWeights(w);
      return mse(net.forwardBatch(x, batch), y, batch);
    };
    const h = 1e-3;
    let worst = 0;
    for (let k = 0; k < w0.length; k++) {
      const probe = Float32Array.from(w0);
      probe[k] = w0[k] + h;
      const lp = lossAt(probe);
      probe[k] = w0[k] - h;
      const numeric = (lp - lossAt(probe)) / (2 * h);
      const rel = Math.abs(numeric - analytic[k]) / Math.max(1e-4, Math.abs(numeric) + Math.abs(analytic[k]));
      worst = Math.max(worst, rel);
    }
    expect(worst).toBeLessThan(2e-2);
  });

  it('learns XOR', () => {
    const net = new MLP({ sizes: [2, 8, 8, 1], seed: 3, lr: 0.02 });
    const x = new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]);
    const y = new Float32Array([0, 1, 1, 0]);
    let loss = Infinity;
    for (let step = 0; step < 2000 && loss >= 1e-3; step++) {
      const out = net.forwardBatch(x, 4);
      loss = mse(out, y, 4);
      net.backwardBatch(Float32Array.from(out, (o, i) => (o - y[i]) / 4), 4);
      net.step();
    }
    expect(loss).toBeLessThan(1e-3);
  });

  it('is reproducible from its seed', () => {
    const a = new MLP({ sizes: [3, 4, 2], seed: 42 }).getWeights();
    const b = new MLP({ sizes: [3, 4, 2], seed: 42 }).getWeights();
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe('weight serialisation', () => {
  it('round-trips the weights bit for bit', () => {
    const w = new MLP({ sizes: [24, 64, 64, 9], seed: 11 }).getWeights();
    expect(Array.from(decodeWeights(encodeWeights(w)))).toEqual(Array.from(w));
  });

  it('keeps the default model far below the 1 MB Firestore document limit', () => {
    const b64 = encodeWeights(new MLP({ sizes: [24, 64, 64, 9], seed: 11 }).getWeights());
    expect(b64.length).toBeLessThan(64 * 1024);
  });

  it('agrees with the platform base64 for every padding length', () => {
    for (const len of [0, 1, 2, 3, 4, 5, 255]) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37) & 255);
      const b64 = bytesToBase64(bytes);
      expect(b64).toBe(Buffer.from(bytes).toString('base64'));
      expect(Array.from(base64ToBytes(b64))).toEqual(Array.from(bytes));
    }
  });
});
