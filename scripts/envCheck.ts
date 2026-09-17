/**
 * Headless racing-environment probe. Two questions:
 *   1. Is the simulation stable under random input (no NaN, nobody escapes)?
 *   2. Can a trivial hand-coded driver complete laps? If not, the bug is in the
 *      physics or the checkpoint logic and no amount of training will fix it.
 */
import { RacingEnv, DEFAULT_RACING_CONFIG, CAR_RADIUS } from '../src/core/games/racing/env';
import { RACING_SPEC, OBS_SIZE } from '../src/core/games/racing/rewards';
import { defaultRewards } from '../src/core/games/types';
import { TRACK_DEFS, getTrack } from '../src/core/games/racing/tracks';
import { mulberry32, randInt } from '../src/core/rng';

const rewards = defaultRewards(RACING_SPEC);
let bad = 0;

for (const def of TRACK_DEFS) {
  // --- random input stability ---
  const env = new RacingEnv({ ...DEFAULT_RACING_CONFIG, trackId: def.id, nCars: 4, laps: 2 }, rewards);
  env.reset(7);
  const rng = mulberry32(3);
  const actions = new Int32Array(4);
  let escaped = 0;
  let nan = 0;
  for (let s = 0; s < 3000; s++) {
    for (let i = 0; i < 4; i++) actions[i] = randInt(rng, 9);
    const res = env.step(actions);
    if (s % 50 === 0) {
      for (const c of env.snapshot().cars) {
        if (!isFinite(c.x) || !isFinite(c.y) || !isFinite(c.angle)) nan++;
        // Outside the wall polygons means the collision push-out failed.
        const t = getTrack(def.id);
        if (c.x < t.bounds.minX || c.x > t.bounds.maxX || c.y < t.bounds.minY || c.y > t.bounds.maxY) escaped++;
      }
    }
    if (res.allDone) env.reset(s);
  }

  // --- scripted driver: aim at the next gate, brake when a wall is close ---
  const drive = new RacingEnv({ ...DEFAULT_RACING_CONFIG, trackId: def.id, nCars: 1, laps: 2, stuckLimit: 600 }, rewards);
  drive.reset(1);
  const obs = new Float32Array(OBS_SIZE);
  const act = new Int32Array(1);
  let steps = 0;
  let laps = 0;
  for (; steps < 6000; steps++) {
    drive.observe(0, obs);
    const lateral = obs[11]; // sin of the bearing to the next gate, car frame
    const steer = lateral > 0.08 ? 2 : lateral < -0.08 ? 0 : 1;
    const frontClear = obs[4];
    const speed = obs[9];
    const throttle = frontClear < 0.25 && speed > 0.35 ? 2 : Math.abs(lateral) > 0.45 && speed > 0.5 ? 1 : 0;
    act[0] = throttle * 3 + steer;
    const res = drive.step(act);
    laps = drive.snapshot().cars[0].lap;
    if (res.allDone) break;
  }

  const ok = nan === 0 && escaped === 0 && laps >= 2;
  if (!ok) bad++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${def.id.padEnd(10)} nan=${nan} escaped=${escaped}  scriptedLaps=${laps} in ${steps} steps  (carR=${CAR_RADIUS}, width=${def.width})`,
  );
}


console.log(bad === 0 ? '\nall environments OK' : `\n${bad} environment check(s) FAILED`);
process.exit(bad === 0 ? 0 : 1);
