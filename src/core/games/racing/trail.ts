import type { RacingSnapshot } from './env';

/**
 * What a car looked like a moment ago, for drawing it smoothly. Kept by
 * whoever draws (the 3D scene, the 2D broadcast), one frame at a time, and
 * never part of the race.
 *
 * A model chooses from a handful of fixed actions - full lock left, straight,
 * full lock right; full throttle or none - and flips between them every few
 * steps. The physics is right to follow that exactly, but drawn as it is the
 * nose shivers, the wheels flick from lock to lock, the trail wags and the
 * exhaust flame strobes faster than the eye can follow. So the picture eases:
 *
 * - **Heading.** The way the car is *travelling* is smooth already (the
 *   tyres carry the velocity round gradually), so the car is drawn along it,
 *   turned by the slip angle (nose against travel) eased over a short time.
 *   Easing the slip, not the heading, means a car in a long corner is never
 *   drawn lagging behind it - only the shiver goes.
 * - **Steering** and the **throttle** (the flame) are eased the same way.
 * - **The trail** is the path the car's centre drove, starting a little way
 *   back along that path, so it no longer swings with every flick of the nose.
 *
 * A replay can jump: when the race clock goes back or leaps ahead, everything
 * is dropped and starts again from the new moment.
 */

/** How far back a trail reaches, in race time. Faster cars cover more ground in it, so their trail is longer. */
export const TRAIL_MS = 650;
/** A clock jump bigger than this is a seek, not a frame. */
const JUMP_MS = 400;
/** Easing times, in race milliseconds. */
const SLIP_MS = 80;
const STEER_MS = 120;
const GAS_ON_MS = 60;
const GAS_OFF_MS = 220;
/** The physics turns a car at most this much a step, at full lock. */
const MAX_YAW_STEP = 0.06;

export interface TrailPoint {
  x: number;
  y: number;
  ms: number;
}

interface CarState {
  /** Slip angle (nose against travel), eased. */
  slip: number;
  /** -1 full lock left .. 1 full lock right, eased. */
  steer: number;
  /** 0 off the throttle .. 1 on it, eased. */
  gas: number;
  lastAngle: number;
  fresh: boolean;
}

export class TrailHistory {
  private points: TrailPoint[][] = [];
  private state: CarState[] = [];
  private lastMs = -1;
  private back = 0;

  /**
   * Record this frame. `back` is how far behind the car's centre the trail
   * starts, in track units.
   */
  update(snap: RacingSnapshot, back: number): void {
    const ms = snap.raceMs;
    this.back = back;
    if (this.lastMs >= 0 && (ms < this.lastMs || ms - this.lastMs > JUMP_MS)) {
      this.points = [];
      this.state = [];
    }
    if (ms === this.lastMs) return;
    const dt = this.lastMs >= 0 ? ms - this.lastMs : 0;
    this.lastMs = ms;
    const ease = (tau: number) => (dt > 0 ? 1 - Math.exp(-dt / tau) : 1);
    snap.cars.forEach((c, i) => {
      const list = (this.points[i] ??= []);
      const s = (this.state[i] ??= { slip: 0, steer: 0, gas: 0, lastAngle: c.angle, fresh: true });
      if (c.done) {
        list.length = 0;
        s.fresh = true;
        return;
      }
      list.push({ x: c.x, y: c.y, ms });
      while (list.length > 0 && ms - list[0].ms > TRAIL_MS + 200) list.shift();

      const slip = slipAngle(c);
      // Steps of physics in this frame: the yaw per step says how hard it was steering.
      const steps = dt / (1000 / 60);
      const yaw = steps > 0 ? wrap(c.angle - s.lastAngle) / steps : 0;
      const steerNow = Math.max(-1, Math.min(1, yaw / MAX_YAW_STEP));
      const gasNow = c.onGas ? 1 : 0;
      if (s.fresh) {
        s.slip = slip;
        s.steer = steerNow;
        s.gas = gasNow;
        s.fresh = false;
      } else {
        s.slip += wrap(slip - s.slip) * ease(SLIP_MS);
        s.steer += (steerNow - s.steer) * ease(STEER_MS);
        s.gas += (gasNow - s.gas) * ease(gasNow > s.gas ? GAS_ON_MS : GAS_OFF_MS);
      }
      s.lastAngle = c.angle;
    });
  }

  /** A car's trail, oldest first: the path its centre drove, starting `back` behind it along that path. */
  of(car: number): readonly TrailPoint[] {
    const list = this.points[car];
    if (!list || list.length < 2) return [];
    // Walk back from the car until `back` of path is behind us.
    let left = this.back;
    let k = list.length - 1;
    let cut: TrailPoint | null = null;
    while (k > 0) {
      const a = list[k];
      const b = list[k - 1];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d >= left) {
        const t = d > 0 ? left / d : 0;
        cut = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, ms: a.ms + (b.ms - a.ms) * t };
        break;
      }
      left -= d;
      k--;
    }
    if (!cut) return [];
    const out = list.slice(0, k);
    out.push(cut);
    // Only as far back in time as a trail reaches, measured from the cut.
    const newest = this.lastMs;
    let start = 0;
    while (start < out.length - 1 && newest - out[start].ms > TRAIL_MS) start++;
    return out.slice(start);
  }

  /**
   * The heading to draw a car at: its direction of travel, turned by the eased
   * slip angle. Falls back to the true heading when there is no history yet,
   * or the car is barely moving (then there is no direction of travel).
   */
  heading(car: number, c: RacingSnapshot['cars'][number]): number {
    const s = this.state[car];
    if (!s || s.fresh || c.done || c.speed < 1) return c.angle;
    return c.angle + slipAngle(c) - s.slip;
  }

  /** Eased steering, -1 .. 1 (full lock left .. right). */
  steer(car: number): number {
    return this.state[car]?.steer ?? 0;
  }

  /** Eased throttle, 0 .. 1: how big the exhaust flame is drawn. */
  gas(car: number, c: RacingSnapshot['cars'][number]): number {
    const s = this.state[car];
    return s && !s.fresh ? s.gas : c.onGas ? 1 : 0;
  }

  clear(): void {
    this.points = [];
    this.state = [];
    this.lastMs = -1;
  }
}

/** The angle between the way the car travels and the way its nose points. */
function slipAngle(c: RacingSnapshot['cars'][number]): number {
  const fwd = Math.sqrt(Math.max(0, c.speed * c.speed - c.slip * c.slip));
  return Math.atan2(c.slip, fwd);
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * A trail as a strip: for each point, its left and right edges and how old
 * it is (0 new, 1 about to go). It narrows towards its old end.
 */
export function trailStrip(
  pts: readonly TrailPoint[],
  nowMs: number,
  halfWidth: number,
): Array<{ lx: number; ly: number; rx: number; ry: number; age: number }> {
  const out: Array<{ lx: number; ly: number; rx: number; ry: number; age: number }> = [];
  for (let i = 0; i < pts.length; i++) {
    // The direction over a few points either side, so the edges do not kink at every sample.
    const a = pts[Math.max(0, i - 3)];
    const b = pts[Math.min(pts.length - 1, i + 3)];
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) {
      dx = 1;
      dy = 0;
    } else {
      dx /= d;
      dy /= d;
    }
    const age = Math.min(1, Math.max(0, (nowMs - pts[i].ms) / TRAIL_MS));
    const w = halfWidth * (1 - age * 0.7);
    out.push({ lx: pts[i].x - dy * w, ly: pts[i].y + dx * w, rx: pts[i].x + dy * w, ry: pts[i].y - dx * w, age });
  }
  return out;
}
