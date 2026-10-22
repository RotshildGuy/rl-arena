import { base64ToBytes, bytesToBase64 } from '../nn/serialize';
import type { Driver } from './sim';

/**
 * Race replays, as the controls each car used.
 *
 * The broadcast re-simulates a race to show it, and it used to do that from
 * every car's weights - which meant handing every team's network to every
 * viewer. A replay keeps only what the cars did: the action each one chose on
 * each step. The physics is deterministic, so feeding those actions back
 * through the same simulation drives the same race, with nobody's weights in
 * the browser.
 *
 * Stored run-length encoded - a car holds one action for many steps in a row -
 * as base64 of (action, varint run length) pairs: a few kilobytes a car.
 */

/** Session id to entry id to that car's encoded actions. */
export type DayReplay = Map<string, Record<string, string>>;

/** The action a car takes when the recording runs out: coast, straight. */
const COAST = 4;

export function encodeActions(actions: ArrayLike<number>): string {
  const bytes: number[] = [];
  for (let i = 0; i < actions.length; ) {
    const a = actions[i];
    let run = 1;
    while (i + run < actions.length && actions[i + run] === a) run++;
    bytes.push(a);
    for (let n = run; ; n >>>= 7) {
      if (n < 128) {
        bytes.push(n);
        break;
      }
      bytes.push((n & 127) | 128);
    }
    i += run;
  }
  return bytesToBase64(Uint8Array.from(bytes));
}

export function decodeActions(encoded: string): Uint8Array {
  const bytes = base64ToBytes(encoded);
  const out: number[] = [];
  for (let i = 0; i < bytes.length; ) {
    const a = bytes[i++];
    let run = 0;
    for (let shift = 0; i < bytes.length; shift += 7) {
      const b = bytes[i++];
      run |= (b & 127) << shift;
      if (b < 128) break;
    }
    for (let k = 0; k < run; k++) out.push(a);
  }
  return Uint8Array.from(out);
}

/** Wraps a driver and keeps every action it takes. */
export class RecordingDriver implements Driver {
  readonly actions: number[] = [];
  constructor(private readonly inner: Driver) {}

  act(obs: Float32Array): number {
    const a = this.inner.act(obs);
    this.actions.push(a);
    return a;
  }
}

/** Drives a car from a recording, step by step, without looking at the road. */
export class ReplayDriver implements Driver {
  private readonly actions: Uint8Array;
  private i = 0;
  constructor(encoded: string) {
    this.actions = decodeActions(encoded);
  }

  act(): number {
    return this.i < this.actions.length ? this.actions[this.i++] : COAST;
  }
}
