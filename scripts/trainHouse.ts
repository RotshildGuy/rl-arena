/**
 * Train one of the house drivers - the cars that fill a thin grid (see
 * `core/champ/house.ts`) - and write its weights to `public/house/<id>.json`.
 *
 *   npx tsx scripts/trainHouse.ts <id> <preset> <generations> [seed] [--continue <trackId>]
 *   npx tsx scripts/trainHouse.ts house-3 aggressive 240
 *   npx tsx scripts/trainHouse.ts house-3 balanced 60 7 --continue harbor
 *
 * `--continue` starts from the driver's current weights instead of from
 * scratch, and every other block of generations is on the named circuit: how
 * a house car learns a circuit added after it was trained, without losing the
 * level it has everywhere else. The checkpoint is still judged on all of them.
 *
 * Neuroevolution rather than DQN: headless it runs twenty-odd times faster, and
 * a house driver only needs to be *a* level, not the best possible one. The
 * calendar rotates through every circuit, so training does too - a block of
 * generations per track, carrying the best genome from one to the next - and
 * the checkpoint kept is the one that drives best over all of them, on the
 * physics the championship races on.
 *
 * "Best" is judged in traffic: a full-distance race of four copies of the
 * checkpoint, contact on, on every circuit. A driver that is quick alone and
 * then locks wheels with the car next to it on lap one is no use on a grid.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { getGame } from '../src/core/games/registry';
import { presetRewards } from '../src/core/games/types';
import { GaTrainer, DEFAULT_GA_HYPER } from '../src/core/rl/ga';
import { decodeWeights, encodeWeights } from '../src/core/nn/serialize';
import { Policy } from '../src/core/rl/policy';
import { SessionSim, QUALI_LAPS } from '../src/core/champ/sim';
import { RACE_LAPS } from '../src/core/champ/format';
import { TRACK_DEFS } from '../src/core/games/racing/tracks';
import { PHYSICS_VERSION } from '../src/core/games/racing/env';
import { RACING_PRESETS, OBS_SIZE } from '../src/core/games/racing/rewards';

const args = process.argv.slice(2);
const contAt = args.indexOf('--continue');
const focusTrack = contAt >= 0 ? args[contAt + 1] : null;
if (contAt >= 0) args.splice(contAt, 2);
const [id, presetId, gensArg, seedArg] = args;
if (!id || !presetId || !gensArg) {
  console.error('usage: trainHouse.ts <id> <preset> <generations> [seed]');
  process.exit(1);
}
const generations = Number(gensArg);
const seed = Number(seedArg ?? 7);
const BLOCK = 10;

const game = getGame('racing');
const preset = RACING_PRESETS.find((p) => p.id === presetId);
if (!preset) throw new Error(`unknown preset ${presetId}`);
const rewards = presetRewards(game.spec, preset);
const hidden = DEFAULT_GA_HYPER.hidden;
const nActions = game.spec.actions.length;

interface TrackEval {
  trackId: string;
  qualiMs: number | null;
  /** Solo, full distance. */
  raceMs: number | null;
  wallHits: number;
  /** Of the four copies in the traffic race, how many saw the flag, and the mean time of those that did. */
  trafficFinishes: number;
  trafficMs: number | null;
}

const TRAFFIC = 4;

/** Each circuit alone, the way qualifying and a full race would run it. */
function evaluate(weights: Float32Array): TrackEval[] {
  const b64 = encodeWeights(weights);
  return TRACK_DEFS.map((t) => {
    const policy = () => Policy.fromBase64(OBS_SIZE, hidden, nActions, b64);
    const q = new SessionSim(t.id, QUALI_LAPS, [{ entryId: id, policy: policy() }], seed, PHYSICS_VERSION);
    q.runToEnd();
    const r = new SessionSim(t.id, RACE_LAPS, [{ entryId: id, policy: policy() }], seed, PHYSICS_VERSION);
    r.runToEnd();
    const rt = r.env.telemetry(0);
    const cars = Array.from({ length: TRAFFIC }, (_, i) => ({ entryId: `${id}-${i}`, policy: policy() }));
    const tr = new SessionSim(t.id, RACE_LAPS, cars, seed, PHYSICS_VERSION);
    tr.runToEnd();
    const done = cars.map((_, i) => tr.env.telemetry(i)).filter((x) => x.finished);
    return {
      trackId: t.id,
      qualiMs: q.env.telemetry(0).bestLapMs,
      raceMs: rt.finished ? rt.totalMs : null,
      wallHits: rt.wallHits,
      trafficFinishes: done.length,
      trafficMs: done.length ? done.reduce((s, x) => s + x.totalMs!, 0) / done.length : null,
    };
  });
}

/**
 * Lower is better. Every car that does not see the flag in traffic costs far
 * more than any lap time can make up, so finishing comes first and pace second.
 */
function cost(ev: TrackEval[]): number {
  return ev.reduce(
    (sum, e) => sum + (TRAFFIC - e.trafficFinishes) * 1_000_000 + (e.trafficMs ?? 0) + (e.raceMs ?? 1_000_000),
    0,
  );
}

let weights: Float32Array | undefined;
let best: { weights: Float32Array; ev: TrackEval[]; cost: number; gen: number } | null = null;
let gen = 0;
const t0 = Date.now();

if (focusTrack) {
  if (!TRACK_DEFS.some((d) => d.id === focusTrack)) throw new Error(`unknown track ${focusTrack}`);
  const current = JSON.parse(readFileSync(`public/house/${id}.json`, 'utf8')) as { weightsB64: string };
  weights = decodeWeights(current.weightsB64);
  // The driver as it is sets the bar: a retrain that ends up worse overall keeps the old weights.
  const ev = evaluate(weights);
  best = { weights: Float32Array.from(weights), ev, cost: cost(ev), gen: 0 };
  console.log(`${id} as it is: traffic finishes ${ev.reduce((s, e) => s + e.trafficFinishes, 0)}/${ev.length * TRAFFIC}`);
}

/** The circuit for a block: in turn through all of them, or every other block on the one being learned. */
function trackFor(block: number) {
  if (!focusTrack) return TRACK_DEFS[block % TRACK_DEFS.length];
  if (block % 2 === 0) return TRACK_DEFS.find((d) => d.id === focusTrack)!;
  const others = TRACK_DEFS.filter((d) => d.id !== focusTrack);
  return others[(block >> 1) % others.length];
}

while (gen < generations) {
  const track = trackFor((gen / BLOCK) | 0);
  const trainer = new GaTrainer({
    gameId: 'racing',
    config: { ...game.defaultConfig(), trackId: track.id, laps: 2, maxSteps: 1500, physics: PHYSICS_VERSION },
    rewards,
    hyper: {},
    seed: seed + gen,
    weights,
    episode: gen,
  });
  const until = Math.min(generations, gen + BLOCK);
  while (gen < until) {
    if (trainer.stepOnce()) gen++;
  }
  weights = trainer.getWeights();
  const ev = evaluate(weights);
  const c = cost(ev);
  if (!best || c < best.cost) best = { weights: Float32Array.from(weights), ev, cost: c, gen };
  const finished = ev.reduce((s, e) => s + e.trafficFinishes, 0);
  console.log(
    `${id} gen ${String(gen).padStart(4)} (${track.id.padEnd(9)})  traffic finishes ${finished}/${ev.length * TRAFFIC}  ` +
      ev.map((e) => `${e.trackId}:${e.qualiMs ? (e.qualiMs / 1000).toFixed(1) : '-'}`).join(' ') +
      `  ${((Date.now() - t0) / 1000).toFixed(0)}s`,
  );
}

mkdirSync('public/house', { recursive: true });
const out = {
  id,
  preset: presetId,
  generations: best!.gen,
  arch: { obsSize: OBS_SIZE, hidden, nActions },
  physics: PHYSICS_VERSION,
  eval: best!.ev,
  weightsB64: encodeWeights(best!.weights),
};
writeFileSync(`public/house/${id}.json`, JSON.stringify(out));
console.log(`\nwrote public/house/${id}.json - best at gen ${best!.gen}`, JSON.stringify(best!.ev));
