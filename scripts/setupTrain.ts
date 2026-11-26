/**
 * Does a car setup change what a *trained model* can do? `setupCheck.ts`
 * answers that for a hand-written driver; this trains real models.
 *
 *   npx tsx scripts/setupTrain.ts <trackId> <setup> <generations> [seed]
 *
 * One model, from scratch, on one circuit, on one setup, with everything else
 * the same as every other run (the house's neuroevolution, default rewards,
 * the race physics). Every 10 generations the model is timed on that circuit
 * - a qualifying run and a full-distance race, alone - and the best
 * checkpoint is kept. At the end that checkpoint is also timed on the other
 * setups, to tell "this setup is faster" from "this model learned this car".
 *
 * Prints one JSON line, for `setupTrainAll` style comparisons.
 */
import { getGame } from '../src/core/games/registry';
import { defaultRewards } from '../src/core/games/types';
import { GaTrainer, DEFAULT_GA_HYPER } from '../src/core/rl/ga';
import { encodeWeights } from '../src/core/nn/serialize';
import { Policy } from '../src/core/rl/policy';
import { SessionSim, QUALI_LAPS } from '../src/core/champ/sim';
import { RACE_LAPS } from '../src/core/champ/format';
import { PHYSICS_VERSION } from '../src/core/games/racing/env';
import { OBS_SIZE } from '../src/core/games/racing/rewards';
import { SETUPS } from '../src/core/games/racing/setup';

const [trackId, setup, gensArg, seedArg] = process.argv.slice(2);
const generations = Number(gensArg ?? 100);
const seed = Number(seedArg ?? 1);
const game = getGame('racing');
const rewards = defaultRewards(game.spec);
const hidden = DEFAULT_GA_HYPER.hidden;
const nActions = game.spec.actions.length;
const EVAL_SEEDS = [11, 12, 13];

interface Timing {
  qualiMs: number | null;
  /** Mean full-race time over the evaluation seeds; null if any run failed to finish. */
  raceMs: number | null;
  wallHits: number;
}

function time(b64: string, on: string): Timing {
  const policy = () => Policy.fromBase64(OBS_SIZE, hidden, nActions, b64);
  let quali: number | null = null;
  let total = 0;
  let finished = true;
  let walls = 0;
  for (const s of EVAL_SEEDS) {
    const q = new SessionSim(trackId, QUALI_LAPS, [{ entryId: 'm', policy: policy(), setup: on }], s, PHYSICS_VERSION);
    q.runToEnd();
    const lap = q.env.telemetry(0).bestLapMs;
    if (lap !== null && (quali === null || lap < quali)) quali = lap;
    const r = new SessionSim(trackId, RACE_LAPS, [{ entryId: 'm', policy: policy(), setup: on }], s, PHYSICS_VERSION);
    r.runToEnd();
    const t = r.env.telemetry(0);
    walls += t.wallHits;
    if (!t.finished) finished = false;
    else total += t.totalMs!;
  }
  return { qualiMs: quali, raceMs: finished ? total / EVAL_SEEDS.length : null, wallHits: walls / EVAL_SEEDS.length };
}

const better = (a: Timing, b: Timing | null) =>
  !b || (a.raceMs !== null && (b.raceMs === null || a.raceMs < b.raceMs)) || (a.raceMs === null && b.raceMs === null && (a.qualiMs ?? Infinity) < (b.qualiMs ?? Infinity));

const trainer = new GaTrainer({
  gameId: 'racing',
  config: { ...game.defaultConfig(), trackId, laps: 2, maxSteps: 1500, physics: PHYSICS_VERSION, setups: [setup, setup, setup, setup, setup, setup, setup, setup] },
  rewards,
  hyper: {},
  seed,
});

let best: { gen: number; b64: string; t: Timing } | null = null;
let gen = 0;
const t0 = Date.now();
while (gen < generations) {
  if (!trainer.stepOnce()) continue;
  gen++;
  if (gen % 10 !== 0 && gen !== generations) continue;
  const b64 = encodeWeights(trainer.getWeights());
  const t = time(b64, setup);
  if (better(t, best?.t ?? null)) best = { gen, b64, t };
}

const onOthers = Object.fromEntries(SETUPS.map((s) => [s.id, time(best!.b64, s.id)]));
console.log(JSON.stringify({ trackId, setup, seed, generations, bestGen: best!.gen, ...best!.t, onOthers, seconds: Math.round((Date.now() - t0) / 1000) }));
