import { describe, expect, it } from 'vitest';
import { Commentator } from './commentary';
import type { CarSnapshot, RacingSnapshot } from '../games/racing/env';

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

/** Feed snapshots every 100 ms from `from` to `to` with the given order. */
function run(c: Commentator, from: number, to: number, order: number[], cars?: CarSnapshot[]) {
  for (let t = from; t <= to; t += 100) c.observe(snap(t, order, cars));
}

describe('commentary', () => {
  it('calls a pass that holds', () => {
    const c = new Commentator(3);
    run(c, 5000, 6000, [0, 1, 2]);
    run(c, 6100, 7500, [1, 0, 2]);
    const kinds = c.comments.map((x) => x.kind);
    expect(kinds).toContain('lead');
    expect(c.comments.find((x) => x.kind === 'lead')).toMatchObject({ car: 1, other: 0, pos: 1 });
  });

  it('says nothing about cars swapping back and forth side by side', () => {
    const c = new Commentator(3);
    run(c, 5000, 6000, [0, 1, 2]);
    for (let t = 6100; t < 9000; t += 100) c.observe(snap(t, Math.floor(t / 300) % 2 ? [1, 0, 2] : [0, 1, 2]));
    expect(c.comments.filter((x) => x.kind === 'lead' || x.kind === 'pass')).toHaveLength(0);
  });

  it('a seek forgets everything and calls nothing from the jump', () => {
    const c = new Commentator(3);
    run(c, 5000, 6000, [0, 1, 2]);
    run(c, 6100, 7500, [1, 0, 2]);
    expect(c.comments.length).toBeGreaterThan(0);
    c.observe(snap(30000, [2, 1, 0]));
    run(c, 30100, 31000, [2, 1, 0]);
    expect(c.comments).toHaveLength(0);
  });

  it('the first car home wins, a retirement is not a pass', () => {
    const c = new Commentator(3);
    const cars = [car(), car(), car()];
    run(c, 5000, 6000, [0, 1, 2], cars);
    // The leader retires and drops to the back: nobody passed him.
    const out = [car({ done: true }), car(), car()];
    run(c, 6100, 7500, [1, 2, 0], out);
    expect(c.comments.map((x) => x.kind)).toEqual(['retired']);
    const home = [car({ done: true }), car({ done: true, finished: true, totalMs: 60000, lap: 3 }), car()];
    run(c, 7600, 8000, [1, 2, 0], home);
    expect(c.comments.at(-1)).toMatchObject({ kind: 'win', car: 1 });
    expect(c.radios.some((r) => r.kind === 'win' && r.car === 1)).toBe(true);
  });

  it('a car a lap down flagged off behind the winner is not on the podium', () => {
    const c = new Commentator(3);
    run(c, 5000, 6000, [0, 1, 2, 3]);
    // The winner and, at the same moment, a lapped car cross the line.
    const flag = [car({ done: true, finished: true, lap: 3 }), car(), car(), car({ done: true, finished: true, lap: 2 })];
    run(c, 6100, 6500, [0, 1, 2, 3], flag);
    expect(c.comments.map((x) => x.kind)).toEqual(['win']);
    const second = [flag[0], car({ done: true, finished: true, lap: 3 }), car(), flag[3]];
    run(c, 6600, 7000, [0, 1, 2, 3], second);
    expect(c.comments.at(-1)).toMatchObject({ kind: 'podium', car: 1, pos: 2 });
  });

  it('a replay reads the same words', () => {
    const a = new Commentator(3);
    const b = new Commentator(3);
    for (const c of [a, b]) {
      run(c, 5000, 6000, [0, 1, 2]);
      run(c, 6100, 7500, [1, 0, 2]);
    }
    expect(a.comments).toEqual(b.comments);
  });
});
