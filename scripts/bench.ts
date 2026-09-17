/** Where does the time actually go? Env simulation, or gradient steps? */
import { RacingEnv, DEFAULT_RACING_CONFIG } from '../src/core/games/racing/env';
import { RACING_SPEC, OBS_SIZE } from '../src/core/games/racing/rewards';
import { defaultRewards } from '../src/core/games/types';
import { DqnAgent } from '../src/core/rl/dqn';
import { mulberry32, randInt } from '../src/core/rng';

function time(label: string, iters: number, fn: () => void): number {
  fn();
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const ms = performance.now() - t0;
  const per = ms / iters;
  console.log(`${label.padEnd(34)} ${(1000 / per).toFixed(0).padStart(9)} /s   (${per.toFixed(3)} ms each)`);
  return 1000 / per;
}

console.log('--- environment (no learning) ---');
for (const nCars of [1, 4, 8]) {
  const env = new RacingEnv({ ...DEFAULT_RACING_CONFIG, nCars, laps: 99 }, defaultRewards(RACING_SPEC));
  env.reset(1);
  const rng = mulberry32(2);
  const a = new Int32Array(nCars);
  const obs = new Float32Array(OBS_SIZE);
  time(`sim step + observe, ${nCars} cars`, 20000, () => {
    for (let i = 0; i < nCars; i++) a[i] = randInt(rng, 9);
    env.step(a);
    for (let i = 0; i < nCars; i++) env.observe(i, obs);
  });
}

console.log('\n--- DQN gradient step ---');
for (const [hidden, batch] of [
  [[128, 128], 64],
  [[128, 128], 32],
  [[96, 96], 32],
  [[64, 64], 64],
  [[64, 64], 32],
  [[48, 48], 32],
] as Array<[number[], number]>) {
  const agent = new DqnAgent(OBS_SIZE, 9, { hidden, batchSize: batch, warmup: 0, bufferSize: 5000 }, 1);
  const o = new Float32Array(OBS_SIZE);
  const rng = mulberry32(9);
  for (let i = 0; i < 2000; i++) {
    for (let k = 0; k < OBS_SIZE; k++) o[k] = rng() * 2 - 1;
    agent.remember(o, randInt(rng, 9), rng(), o, rng() < 0.02);
  }
  time(`hidden=[${hidden}] batch=${batch}`, 400, () => {
    agent.trainStep();
  });
}

console.log('\n--- greedy inference (race mode) ---');
const inf = new DqnAgent(OBS_SIZE, 9, { hidden: [64, 64] }, 1);
const o = new Float32Array(OBS_SIZE);
time('actGreedy, hidden=[64,64]', 200000, () => {
  inf.actGreedy(o);
});
