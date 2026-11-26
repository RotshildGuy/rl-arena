import type { RacingSnapshot } from './env';

/**
 * Where each car has just been, for the trail prize: a short history of the
 * point behind its gearbox, so a trail follows the line the car drove and
 * bends with it through a corner, instead of sticking straight out the back.
 *
 * Kept by whoever draws (the 3D scene, the 2D broadcast), one frame at a
 * time. A replay can jump: when the race clock goes back or leaps ahead, the
 * history is dropped and the trail grows again from the new moment - a trail
 * is a picture, never part of the race.
 */

/** How far back a trail reaches, in race time. Faster cars cover more ground in it, so their trail is longer. */
export const TRAIL_MS = 650;
/** A clock jump bigger than this is a seek, not a frame. */
const JUMP_MS = 400;

export interface TrailPoint {
  x: number;
  y: number;
  ms: number;
}

export class TrailHistory {
  private points: TrailPoint[][] = [];
  private lastMs = -1;

  /**
   * Record this frame. `back` is how far behind the car's centre the trail
   * starts, in track units.
   */
  update(snap: RacingSnapshot, back: number): void {
    const ms = snap.raceMs;
    if (this.lastMs >= 0 && (ms < this.lastMs || ms - this.lastMs > JUMP_MS)) this.points = [];
    if (ms === this.lastMs) return;
    this.lastMs = ms;
    snap.cars.forEach((c, i) => {
      const list = (this.points[i] ??= []);
      if (c.done) {
        list.length = 0;
        return;
      }
      list.push({ x: c.x - Math.cos(c.angle) * back, y: c.y - Math.sin(c.angle) * back, ms });
      while (list.length > 0 && ms - list[0].ms > TRAIL_MS) list.shift();
    });
  }

  /** A car's trail, oldest first. */
  of(car: number): readonly TrailPoint[] {
    return this.points[car] ?? [];
  }

  clear(): void {
    this.points = [];
    this.lastMs = -1;
  }
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
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
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
