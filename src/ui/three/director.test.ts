import { describe, expect, it } from 'vitest';
import type { CarSnapshot, RacingSnapshot } from '../../core/games/racing/env';
import { BATTLE_CONFIRM_MS, Director, MAX_HOLD_MS, MIN_HOLD_MS, START_END_MS, type DirectorState } from './director';

function car(over: Partial<CarSnapshot> = {}): CarSnapshot {
  return {
    x: 0, y: 0, angle: 0, speed: 4, lap: 1, nextCp: 0, progress: 0,
    done: false, finished: false, touchingWall: false, touchingCar: false, reverse: false,
    sliding: false, slip: 0, trackPos: 0, sector: 0, currentLapMs: 0, lastLapMs: null,
    bestLapMs: null, lastSectorsMs: [null, null, null], totalMs: null, gapMs: 0, intervalMs: 3000,
    ...over,
  };
}

function snap(raceMs: number, cars: CarSnapshot[]): RacingSnapshot {
  return {
    trackId: 'oval', step: Math.round(raceMs / 16.67), raceMs, laps: 5, cars,
    order: cars.map((_, i) => i), fastestLap: null, focus: 0, sensors: [],
  } as RacingSnapshot;
}

const field = (over: (i: number, ms: number) => Partial<CarSnapshot> = () => ({})) => (ms: number) =>
  Array.from({ length: 4 }, (_, i) => car({ intervalMs: i === 0 ? 0 : 3000, ...over(i, ms) }));

/** Run the director over a stretch of race at 30 frames a second, collecting every cut. */
function run(d: Director, from: number, to: number, cars: (ms: number) => CarSnapshot[]): DirectorState[] {
  const cuts: DirectorState[] = [];
  for (let ms = from; ms <= to; ms += 33) {
    const s = d.update(snap(ms, cars(ms)));
    if (s.cut) cuts.push({ ...s });
  }
  return cuts;
}

describe('director', () => {
  it('opens on the overview, then the front two from above, then the pack', () => {
    const d = new Director(10);
    const cuts = run(d, 0, START_END_MS - 100, field());
    expect(cuts.map((c) => c.shot)).toEqual(['overview', 'heli', 'chase']);
    expect(cuts[1]).toMatchObject({ car: 0, rival: 1 });
    expect(cuts[2].car).toBe(2);
  });

  it('holds every shot at least MIN_HOLD_MS, about one cut a lap', () => {
    const d = new Director(10);
    const cuts = run(d, START_END_MS, START_END_MS + 60000, field());
    for (let k = 1; k < cuts.length; k++) {
      const len = cuts[k].cutAt - cuts[k - 1].cutAt;
      expect(len).toBeGreaterThanOrEqual(cuts[k - 1].shot === 'trackside' ? 3500 : cuts[k - 1].shot === 'overview' ? 4000 : MIN_HOLD_MS);
      expect(len).toBeLessThanOrEqual(18000 + 100);
    }
    // 60 s of a quiet race: no more than one cut every five seconds.
    expect(cuts.length).toBeLessThanOrEqual(12);
  });

  it('never cuts to the same shot of the same car', () => {
    const d = new Director(10);
    const cuts = run(d, START_END_MS, START_END_MS + 90000, field());
    for (let k = 1; k < cuts.length; k++) {
      expect(cuts[k].car === cuts[k - 1].car && cuts[k].shot === cuts[k - 1].shot).toBe(false);
    }
  });

  it('cuts to a battle only once it has lasted, and keeps both cars', () => {
    const d = new Director(10);
    const t0 = START_END_MS;
    run(d, t0, t0 + MIN_HOLD_MS, field());
    // A gap that closes for half a second and opens again is not a battle.
    const blip = run(d, t0 + MIN_HOLD_MS, t0 + MIN_HOLD_MS + 500, field((i) => (i === 2 ? { intervalMs: 400 } : {})));
    expect(blip.some((c) => c.reason === 'battle')).toBe(false);
    // The gap opens again and stays open long enough to end it.
    run(d, t0 + MIN_HOLD_MS + 533, t0 + MIN_HOLD_MS + 3966, field());
    const from = t0 + MIN_HOLD_MS + 4000;
    const cuts = run(d, from, from + MIN_HOLD_MS + BATTLE_CONFIRM_MS + 2500, field((i) => (i === 2 ? { intervalMs: 400 } : {})));
    const battle = cuts.find((c) => c.reason === 'battle');
    expect(battle).toMatchObject({ car: 2, rival: 1 });
    expect(battle!.cutAt - from).toBeGreaterThanOrEqual(BATTLE_CONFIRM_MS);
  });

  it('does not cut while the car is in a corner, but not for ever', () => {
    const d = new Director(10);
    const t0 = START_END_MS;
    run(d, t0, t0 + 1000, field());
    // From now on every car turns hard: 1.2 rad/s.
    const turning = field((_, ms) => ({ angle: (ms / 1000) * 1.2 }));
    const cuts = run(d, t0 + 1000, t0 + 1000 + MAX_HOLD_MS + 4000, turning);
    // Held past its planned length while cornering, but cut by the time the shot ran out.
    expect(cuts.length).toBeGreaterThan(0);
    expect(cuts[0].cutAt - t0).toBeGreaterThanOrEqual(MIN_HOLD_MS + 2000 - 100);
  });

  it('cuts to a real incident early, and ignores a scrape', () => {
    const d = new Director(10);
    const t0 = START_END_MS;
    run(d, t0, t0 + 3000, field());
    const scrape = run(d, t0 + 3000, t0 + 3300, field((i) => (i === 3 ? { touchingWall: true, speed: 2 } : {})));
    expect(scrape.some((c) => c.reason === 'incident')).toBe(false);
    const hit = run(d, t0 + 3300, t0 + 3600, field((i, ms) => (i === 3 ? { touchingCar: true, speed: ms > t0 + 3400 ? 1.5 : 4 } : {})));
    expect(hit.find((c) => c.reason === 'incident')?.car).toBe(3);
  });

  it('does not cut in bursts as the cars take the flag one after another', () => {
    const d = new Director(10);
    const t0 = START_END_MS;
    run(d, t0, t0 + 20000, field());
    // From t1 a car crosses the line every 300 ms.
    const t1 = t0 + 20000;
    const flag = field((i, ms) => (ms >= t1 + i * 300 ? { lap: 10, done: true, finished: true } : { lap: 9 }));
    const cuts = run(d, t1, t1 + 2500, flag);
    for (let k = 1; k < cuts.length; k++) expect(cuts[k].cutAt - cuts[k - 1].cutAt).toBeGreaterThanOrEqual(2000);
  });

  it('starts again after a seek backwards', () => {
    const d = new Director(10);
    run(d, START_END_MS, START_END_MS + 20000, field());
    expect(d.update(snap(500, field()(500)))).toMatchObject({ reason: 'start', shot: 'overview' });
  });
});
