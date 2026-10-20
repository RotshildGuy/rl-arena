/**
 * Can a dumb driver win? Two hand-written reference drivers to find out.
 *
 * Both steer the same way — at a point a little way down the
 * centreline. They differ only in what they do with the pedals:
 *
 *   flat out   — gas, always. The strategy anyone tries first, and the one a
 *                two-line script can play.
 *   braking    — reads the corners ahead and brakes to the speed the tyres can
 *                carry through them. A stand-in for a driver that has learned
 *                something.
 *
 * The championship is meant to reward learning, so the physics is right when
 * flat out is clearly slower than braking — or does not finish at all — on
 * every circuit. On version 1 it is not; that is why version 2 exists.
 *
 * Used by `scripts/driverCheck.ts`, which prints the comparison, and by
 * `npm run sanity`, which fails if flat out stops losing.
 */
import { RacingEnv, DEFAULT_RACING_CONFIG } from '../src/core/games/racing/env';
import { RACING_SPEC } from '../src/core/games/racing/rewards';
import { defaultRewards } from '../src/core/games/types';
import { getTrack, type Track } from '../src/core/games/racing/tracks';

export const LAPS = 3;
const rewards = defaultRewards(RACING_SPEC);

/** Unsigned curvature of the centreline at every sample, from the turn of the tangent. */
function curvatures(t: Track): Float64Array {
  const n = t.def.samples;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 2 + n) % n;
    const b = (i + 2) % n;
    const turn = Math.abs(
      Math.atan2(
        t.tangent[a * 2] * t.tangent[b * 2 + 1] - t.tangent[a * 2 + 1] * t.tangent[b * 2],
        t.tangent[a * 2] * t.tangent[b * 2] + t.tangent[a * 2 + 1] * t.tangent[b * 2 + 1],
      ),
    );
    const dist = Math.hypot(t.center[b * 2] - t.center[a * 2], t.center[b * 2 + 1] - t.center[a * 2 + 1]);
    out[i] = turn / (dist || 1);
  }
  return out;
}

function nearest(t: Track, x: number, y: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < t.def.samples; i++) {
    const d = (t.center[i * 2] - x) ** 2 + (t.center[i * 2 + 1] - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export interface Outcome {
  finished: boolean;
  laps: number;
  totalMs: number | null;
  bestLapMs: number | null;
  wallHits: number;
}

/** How hard a braking driver trusts the tyres in a corner, and how hard it brakes for one. */
interface Braking {
  grip: number;
  decel: number;
}

export function drive(trackId: string, physics: number, braking: Braking | null): Outcome {
  const t = getTrack(trackId);
  const kappa = curvatures(t);
  const n = t.def.samples;
  const spacing = t.length / n;
  const env = new RacingEnv(
    { ...DEFAULT_RACING_CONFIG, trackId, nCars: 1, laps: LAPS, maxSteps: LAPS * 1500, stuckLimit: 600, physics },
    rewards,
  );
  env.reset(1);
  const act = new Int32Array(1);

  for (let s = 0; s < LAPS * 1500; s++) {
    const car = env.snapshot().cars[0];
    const idx = nearest(t, car.x, car.y);

    // Steering: at a point a little way down the road, further at speed.
    const ahead = (idx + 5 + Math.round(car.speed * 1.2)) % n;
    const dx = t.center[ahead * 2] - car.x;
    const dy = t.center[ahead * 2 + 1] - car.y;
    const bearing = Math.atan2(-dx * Math.sin(car.angle) + dy * Math.cos(car.angle), dx * Math.cos(car.angle) + dy * Math.sin(car.angle));
    const steer = bearing > 0.03 ? 2 : bearing < -0.03 ? 0 : 1;

    let throttle = 0;
    if (braking) {
      // The fastest speed that still makes every corner in sight, allowing for
      // the distance there is to brake before each one.
      let target = Infinity;
      for (let k = 0; k < 40; k++) {
        const j = (idx + k) % n;
        const kj = Math.max(kappa[j], 1e-6);
        const corner = Math.min(Math.sqrt(braking.grip / kj), 0.055 / kj);
        target = Math.min(target, Math.sqrt(corner * corner + 2 * braking.decel * k * spacing));
      }
      throttle = car.speed > target + 0.15 ? 2 : car.speed < target ? 0 : 1;
    }
    act[0] = throttle * 3 + steer;
    if (env.step(act).allDone) break;
  }

  const tel = env.telemetry(0);
  return { finished: tel.finished, laps: tel.laps, totalMs: tel.totalMs, bestLapMs: tel.bestLapMs, wallHits: tel.wallHits };
}

/**
 * The braking driver at its best on this circuit: every combination of corner
 * speed and braking effort is tried and the fastest finish kept. That stands
 * in for a model that has learned where to brake — a fixed guess would only
 * measure how good the guess was.
 */
export function bestBraking(trackId: string, physics: number): Outcome {
  let best: Outcome | null = null;
  for (const grip of [0.05, 0.07, 0.09, 0.11, 0.13, 0.16, 0.2, 0.3]) {
    for (const decel of [0.1, 0.2, 0.3]) {
      const o = drive(trackId, physics, { grip, decel });
      if (!o.finished) continue;
      if (!best || o.totalMs! < best.totalMs!) best = o;
    }
  }
  return best ?? drive(trackId, physics, { grip: 0.05, decel: 0.1 });
}

/** Flat out loses when it does not finish, or finishes more than 5% behind. */
export function flatOutLoses(flat: Outcome, brake: Outcome): boolean {
  if (!brake.finished) return false;
  if (!flat.finished) return true;
  return flat.totalMs! > brake.totalMs! * 1.05;
}
