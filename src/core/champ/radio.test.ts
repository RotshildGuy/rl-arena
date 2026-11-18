import { describe, expect, it } from 'vitest';
import { TeamRadio } from './radio';
import type { CarSnapshot, RacingSnapshot } from '../games/racing/env';
import { broadcast as he } from '../../i18n/he/broadcast';
import { broadcast as en } from '../../i18n/en/broadcast';

function car(over: Partial<CarSnapshot> = {}): CarSnapshot {
  return {
    x: 0, y: 0, angle: 0, speed: 5, lap: 0, nextCp: 0, progress: 0,
    done: false, finished: false, touchingWall: false, touchingCar: false, reverse: false,
    sliding: false, slip: 0, trackPos: 0, sector: 0, currentLapMs: 0,
    lastLapMs: null, bestLapMs: null, lastSectorsMs: [null, null, null], totalMs: null,
    gapMs: 0, intervalMs: 2000,
    ...over,
  };
}

function snap(raceMs: number, order: number[], cars: CarSnapshot[] = order.map(() => car())): RacingSnapshot {
  return { trackId: 'oval', step: Math.round(raceMs / (1000 / 60)), laps: 3, cars, focus: 0, sensors: [], order, raceMs, fastestLap: null };
}

/** Feed snapshots every 100 ms from `from` to `to`. */
function run(r: TeamRadio, from: number, to: number, order: number[], cars?: CarSnapshot[]) {
  for (let t = from; t <= to; t += 100) r.observe(snap(t, order, cars));
}

describe('team radio', () => {
  it('calls a pass that holds', () => {
    const r = new TeamRadio(3);
    run(r, 5000, 6000, [0, 1, 2]);
    run(r, 6100, 7500, [1, 0, 2]);
    expect(r.radios).toEqual([expect.objectContaining({ kind: 'passMade', car: 1 })]);
  });

  it('says nothing about cars swapping back and forth side by side', () => {
    const r = new TeamRadio(3);
    run(r, 5000, 6000, [0, 1, 2]);
    for (let t = 6100; t < 9000; t += 100) r.observe(snap(t, Math.floor(t / 300) % 2 ? [1, 0, 2] : [0, 1, 2]));
    expect(r.radios).toHaveLength(0);
  });

  it('a seek forgets everything and calls nothing from the jump', () => {
    const r = new TeamRadio(3);
    run(r, 5000, 6000, [0, 1, 2]);
    run(r, 6100, 7500, [1, 0, 2]);
    expect(r.radios.length).toBeGreaterThan(0);
    r.observe(snap(30000, [2, 1, 0]));
    run(r, 30100, 31000, [2, 1, 0]);
    expect(r.radios).toHaveLength(0);
  });

  it('the winner is the first in the classification, not a lapped car flagged with him', () => {
    const r = new TeamRadio(3);
    run(r, 5000, 6000, [0, 1, 2, 3]);
    const flag = [car({ done: true, finished: true, lap: 3 }), car(), car(), car({ done: true, finished: true, lap: 2 })];
    run(r, 6100, 6500, [0, 1, 2, 3], flag);
    expect(r.radios.map((x) => `${x.kind}:${x.car}`)).toEqual(['win:0']);
  });

  it('cars hitting the wall one after another never hear the same words twice in a row', () => {
    const r = new TeamRadio(3);
    const n = 8;
    const order = Array.from({ length: n }, (_, i) => i);
    run(r, 5000, 6000, order);
    // Every seven seconds, one more car slams into the wall.
    for (let k = 0; k < n; k++) {
      const t = 6100 + k * 7000;
      run(r, t, t + 300, order);
      const hit = order.map((i) => (i === k ? car({ touchingWall: true, speed: 1 }) : car()));
      run(r, t + 400, t + 500, order, hit);
      run(r, t + 600, t + 6900, order);
    }
    const walls = r.radios.filter((x) => x.kind === 'wall');
    expect(walls.length).toBeGreaterThanOrEqual(5);
    for (const words of [he.radio.wall, en.radio.wall]) {
      const picked = walls.map((w) => w.variant % words.length);
      // As many different wordings as calls, up to the size of the list.
      expect(new Set(picked).size).toBe(Math.min(picked.length, words.length));
    }
  });

  it('a replay reads the same words', () => {
    const a = new TeamRadio(3);
    const b = new TeamRadio(3);
    for (const r of [a, b]) {
      run(r, 5000, 6000, [0, 1, 2]);
      run(r, 6100, 7500, [1, 0, 2]);
    }
    expect(a.radios).toEqual(b.radios);
  });

  it('every kind has several wordings, in both languages', () => {
    for (const words of [he.radio, en.radio]) {
      for (const [kind, takes] of Object.entries(words)) expect(takes.length, kind).toBeGreaterThanOrEqual(6);
    }
    expect(he.radio.wall.length).toBe(en.radio.wall.length);
  });
});
