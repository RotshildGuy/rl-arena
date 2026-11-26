import { CAR_RADIUS, type RacingSnapshot } from './env';
import type { Track } from './tracks';

/**
 * Where to draw each car, so no two cars and no car and wall ever look as if
 * they went into each other.
 *
 * Both the 2D and the 3D car fit inside the circle the physics collides (`CAR_RADIUS`), but
 * the physics resolves each contact once per step, so in a pile-up or a car
 * pushed into a wall it can leave a car up to about 2 units inside another or
 * inside the wall until the next step. That stays exactly as it is - the race
 * is the race - and only the picture is nudged apart, by at most that much,
 * which nobody can see as a move but everybody sees as a car through a wall.
 */
export function settle(snap: RacingSnapshot, track: Track, out: Float32Array = new Float32Array(0)): Float32Array {
  const n = snap.cars.length;
  const pos = out.length === n * 2 ? out : new Float32Array(n * 2);
  snap.cars.forEach((c, i) => {
    pos[i * 2] = c.x;
    pos[i * 2 + 1] = c.y;
  });
  const normal = new Float32Array(2);
  const min = CAR_RADIUS * 2;
  // A car against a wall cannot give way, so in a squeeze the other one does.
  const pinned = new Uint8Array(n);
  const walls = () => {
    for (let i = 0; i < n; i++) {
      const depth = track.grid.circleOverlap(pos[i * 2], pos[i * 2 + 1], CAR_RADIUS, normal);
      if (depth <= 0) continue;
      pinned[i] = 1;
      pos[i * 2] += normal[0] * depth;
      pos[i * 2 + 1] += normal[1] * depth;
    }
  };
  walls();
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 0; i < n; i++) {
      // A car out of the race is a ghost: others may drive through it.
      if (snap.cars[i].done) continue;
      for (let j = i + 1; j < n; j++) {
        if (snap.cars[j].done) continue;
        const dx = pos[j * 2] - pos[i * 2];
        const dy = pos[j * 2 + 1] - pos[i * 2 + 1];
        const d = Math.hypot(dx, dy);
        if (d >= min || d < 1e-6) continue;
        const gap = min - d;
        const wi = pinned[i] === pinned[j] ? 0.5 : pinned[i] ? 0 : 1;
        pos[i * 2] -= (dx / d) * gap * wi;
        pos[i * 2 + 1] -= (dy / d) * gap * wi;
        pos[j * 2] += (dx / d) * gap * (1 - wi);
        pos[j * 2 + 1] += (dy / d) * gap * (1 - wi);
      }
    }
    walls();
  }
  return pos;
}
