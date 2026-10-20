/**
 * Correctness gate for the learning core. If these fail the bug is in backprop
 * or in DQN, not in the game simulation — so run this before debugging anything
 * that looks like "the car won't learn".
 *
 *   npm run sanity
 */
import { MLP } from '../src/core/nn/mlp';
import { encodeWeights, decodeWeights } from '../src/core/nn/serialize';
import { DqnAgent } from '../src/core/rl/dqn';
import { mulberry32 } from '../src/core/rng';
import { TRACK_DEFS, buildTrack, segmentsIntersect } from '../src/core/games/racing/tracks';
import { defaultRewards, levelOf, matchingPreset, presetRewards } from '../src/core/games/types';
import { GaTrainer, GaLearner } from '../src/core/rl/ga';
import { TrainingSession } from '../src/core/rl/session';
import { getGame } from '../src/core/games/registry';
import { RacingEnv, DEFAULT_RACING_CONFIG, STEP_MS, PHYSICS_VERSION } from '../src/core/games/racing/env';
import { bestBraking, drive, flatOutLoses } from './drivers';
import { physicsForRound, PHYSICS_V2_ROUND } from '../src/core/champ/schedule';
import { RACING_SPEC, OBS_SIZE, RACING_PRESETS } from '../src/core/games/racing/rewards';
import { planSessions, GRID_SIZE, MIN_ENTRIES, RACE_LAPS, SESSION_GAP_MS } from '../src/core/champ/format';
import { awardPoints, buildStandings, POINTS } from '../src/core/champ/points';
import { isNameOk, nameKey, normalizeName, NAME_MAX } from '../src/core/champ/names';
import { resolveCompetitor } from '../src/ui/competitorMerge';
import { NAME_ADJECTIVES, NAME_NOUNS, isCleanName, randomModelName } from '../src/core/champ/nameGen';
import {
  airingRound,
  currentRound,
  lockAtForRound,
  startsAtForRound,
  trackForRound,
  BROADCAST_OPENS_MS,
  LOCK_BEFORE_MS,
  DAY_MS,
} from '../src/core/champ/schedule';
import { nextRoundOnTrack, trainingTarget } from '../src/core/champ/records';
import { eligibleEntries, MAX_CARS_PER_TEAM } from '../src/core/champ/card';
import {
  broadcastOpensAt,
  dayState,
  dayStatus,
  liveSession,
  resultsVisible,
  sessionWindows,
  settledResults,
} from '../src/core/champ/timing';
import type { DayPlace, Finish, RaceCard, RaceResult } from '../src/core/champ/types';
import { coachStepFor, type CoachState } from '../src/ui/coachStep';
import { summarize, dayKey, type MetricRow } from '../src/core/metrics';
import { foldLine, googleCalendarUrl, raceCalendarIcs } from '../src/ui/calendar';
import { carRecaps } from '../src/core/champ/recap';
import { diagnoseCar, diagnoseDay } from '../src/core/champ/diagnose';
import { buildRaceCard } from '../src/core/champ/card';
import { runRaceDay } from '../src/core/champ/sim';
import { hallOfFame, seasonCards, seasonComplete } from '../src/core/champ/seasons';
import { raceIdForRound, seasonForRound, seasonNumber, seasonRange, seedForRound, displaySeason } from '../src/core/champ/schedule';
import { HOUSE_DRIVERS, HOUSE_FROM_ROUND, HOUSE_GRID, HOUSE_TEAM, HOUSE_UID } from '../src/core/champ/house';
import { teamNameProblem } from '../src/core/champ/names';
import { readFileSync } from 'node:fs';
import { Policy } from '../src/core/rl/policy';
import { SessionSim, QUALI_LAPS } from '../src/core/champ/sim';

let failures = 0;
const CHAPTER = String.fromCharCode(10);

function check(name: string, ok: boolean, detail = ''): void {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

// ---------------------------------------------------------------- gradients
function gradientCheck(): void {
  console.log('\ngradient check (analytic vs. finite differences)');
  const net = new MLP({ sizes: [4, 6, 5, 3], seed: 7, maxGradNorm: 0 });
  const rng = mulberry32(99);
  const batch = 5;
  const x = new Float32Array(batch * 4);
  const y = new Float32Array(batch * 3);
  for (let i = 0; i < x.length; i++) x[i] = rng() * 2 - 1;
  for (let i = 0; i < y.length; i++) y[i] = rng() * 2 - 1;

  const loss = (w: Float32Array): number => {
    net.setWeights(w);
    const out = net.forwardBatch(x, batch);
    let s = 0;
    for (let i = 0; i < y.length; i++) {
      const d = out[i] - y[i];
      s += 0.5 * d * d;
    }
    return s / batch;
  };

  const w0 = net.getWeights();
  net.setWeights(w0);
  const out = net.forwardBatch(x, batch);
  const dOut = new Float32Array(batch * 3);
  for (let i = 0; i < dOut.length; i++) dOut[i] = (out[i] - y[i]) / batch;
  net.zeroGrads();
  net.backwardBatch(dOut, batch);
  const analytic = net.getGradients();

  const h = 1e-3;
  let worst = 0;
  let worstIdx = -1;
  for (let k = 0; k < w0.length; k++) {
    const probe = Float32Array.from(w0);
    probe[k] = w0[k] + h;
    const lp = loss(probe);
    probe[k] = w0[k] - h;
    const lm = loss(probe);
    const numeric = (lp - lm) / (2 * h);
    const denom = Math.max(1e-4, Math.abs(numeric) + Math.abs(analytic[k]));
    const rel = Math.abs(numeric - analytic[k]) / denom;
    if (rel > worst) {
      worst = rel;
      worstIdx = k;
    }
  }
  check('max relative gradient error < 2e-2', worst < 2e-2, `worst=${worst.toExponential(2)} at param ${worstIdx}`);
}

// --------------------------------------------------------------------- XOR
function xorTest(): void {
  console.log('\nXOR (does the net learn a non-linear function at all?)');
  const net = new MLP({ sizes: [2, 8, 8, 1], seed: 3, lr: 0.02 });
  const X = new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]);
  const Y = new Float32Array([0, 1, 1, 0]);
  const dOut = new Float32Array(4);
  let loss = 0;
  let steps = 0;
  for (; steps < 2000; steps++) {
    const out = net.forwardBatch(X, 4);
    loss = 0;
    for (let i = 0; i < 4; i++) {
      const d = out[i] - Y[i];
      loss += 0.5 * d * d;
      dOut[i] = d / 4;
    }
    loss /= 4;
    if (loss < 1e-3) break;
    net.backwardBatch(dOut, 4);
    net.step();
  }
  check('XOR converges within 2000 steps', loss < 1e-3, `steps=${steps} loss=${loss.toExponential(2)}`);
}

// --------------------------------------------------------------- serialize
function serializeTest(): void {
  console.log('\nweight serialisation round-trip');
  // The default architecture, and a much larger one, to bound the document size.
  for (const sizes of [[24, 64, 64, 9], [24, 256, 256, 9]]) {
    const net = new MLP({ sizes, seed: 11 });
    const w = net.getWeights();
    const b64 = encodeWeights(w);
    const back = decodeWeights(b64);
    let maxDiff = 0;
    for (let i = 0; i < w.length; i++) maxDiff = Math.max(maxDiff, Math.abs(w[i] - back[i]));
    const kb = (b64.length / 1024).toFixed(1);
    check(
      `${sizes.join('-')} round-trips losslessly and fits a Firestore document`,
      back.length === w.length && maxDiff === 0 && b64.length < 900_000,
      `${w.length} params, ${kb} KB base64`,
    );
  }
}

// -------------------------------------------------------------------- DQN
/**
 * Corridor world: 15 cells, start in the middle, +1 for reaching the right end,
 * -1 for the left end, -0.01 per step. Optimal policy is "always right".
 */
function corridorTest(): void {
  console.log('\nDQN on a toy corridor');
  const N = 15;
  const agent = new DqnAgent(1, 2, {
    hidden: [32, 32],
    lr: 1e-3,
    bufferSize: 20_000,
    warmup: 200,
    batchSize: 32,
    targetSync: 200,
    epsDecaySteps: 3000,
  }, 5);
  const rng = mulberry32(42);

  const obs = new Float32Array(1);
  const nextObs = new Float32Array(1);
  const encode = (pos: number, into: Float32Array) => {
    into[0] = (pos / (N - 1)) * 2 - 1;
  };

  for (let ep = 0; ep < 300; ep++) {
    let pos = 3 + Math.floor(rng() * (N - 6));
    encode(pos, obs);
    for (let t = 0; t < 60; t++) {
      const a = agent.act(obs);
      pos += a === 1 ? 1 : -1;
      let reward = -0.01;
      let done = false;
      if (pos >= N - 1) {
        reward += 1;
        done = true;
      } else if (pos <= 0) {
        reward -= 1;
        done = true;
      }
      encode(pos, nextObs);
      agent.remember(obs, a, reward, nextObs, done);
      agent.trainStep();
      obs[0] = nextObs[0];
      if (done) break;
    }
  }

  // Greedy evaluation from every interior start.
  let solved = 0;
  let total = 0;
  for (let start = 1; start < N - 1; start++) {
    let pos = start;
    encode(pos, obs);
    let ok = false;
    for (let t = 0; t < 60; t++) {
      pos += agent.actGreedy(obs) === 1 ? 1 : -1;
      if (pos >= N - 1) {
        ok = true;
        break;
      }
      if (pos <= 0) break;
      encode(pos, obs);
    }
    total++;
    if (ok) solved++;
  }
  check('greedy policy reaches the goal from every start', solved === total, `${solved}/${total}, gradSteps=${agent.gradSteps}`);
}

// ------------------------------------------------------------------ tracks
/**
 * The walls are offset curves of the centreline. If a track bends tighter than
 * half its width the inner wall folds over itself and the car ends up trapped in
 * geometry that looks fine on screen — so check every track for self-crossings.
 */
function trackTest(): void {
  console.log('\ntrack geometry');
  for (const def of TRACK_DEFS) {
    const t = buildTrack(def);
    const n = def.samples;
    let crossings = 0;
    for (const wall of [t.inner, t.outer]) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 2; j < n; j++) {
          if (i === 0 && j === n - 1) continue;
          const b = (i + 1) % n;
          const d = (j + 1) % n;
          if (
            segmentsIntersect(
              wall[i * 2], wall[i * 2 + 1], wall[b * 2], wall[b * 2 + 1],
              wall[j * 2], wall[j * 2 + 1], wall[d * 2], wall[d * 2 + 1],
            )
          ) {
            crossings++;
          }
        }
      }
    }
    check(
      `track "${def.id}" walls do not fold over`,
      crossings === 0,
      `crossings=${crossings} len=${t.length.toFixed(0)} checkpoints=${t.nCheckpoints}`,
    );
  }
}

// --------------------------------------------------------------------- GA
function gaTest(): void {
  console.log(CHAPTER + 'neuroevolution');
  const game = getGame('racing');
  const trainer = new GaTrainer({
    gameId: 'racing',
    config: { ...game.defaultConfig(), laps: 2, maxSteps: 900 },
    rewards: defaultRewards(game.spec),
    hyper: { populationSize: 16 },
    seed: 3,
  });

  const rewards: number[] = [];
  while (rewards.length < 14) {
    const stats = trainer.stepOnce();
    if (stats) rewards.push(stats.reward);
  }
  const early = (rewards[0] + rewards[1] + rewards[2]) / 3;
  const late = (rewards[11] + rewards[12] + rewards[13]) / 3;
  check('mean fitness improves over 14 generations', late > early, `${early.toFixed(1)} -> ${late.toFixed(1)}`);
  check('the best genome is saveable', trainer.getWeights().length > 0, `${trainer.getWeights().length} params`);
}

// ------------------------------------------------------- shared training
/**
 * Several models in one environment.
 *
 * The point of training together is that the cars actually interfere with each
 * other, so the two things that must hold are: the seats really are split
 * between the learners, and each learner is scored by its *own* reward table.
 */
function sharedSessionTest(): void {
  console.log(CHAPTER + 'several models on one grid');
  const game = getGame('racing');
  const careful = defaultRewards(game.spec);
  const reckless = { ...careful, wallHit: 0, speed: 0.25 };

  const learners: GaLearner[] = [];
  const session = new TrainingSession({
    gameId: 'racing',
    config: { ...game.defaultConfig(), nCars: 4, laps: 2, maxSteps: 700 },
    rewards: [careful, reckless],
    seed: 11,
    makeLearner: (_slot, seats) => {
      const l = new GaLearner({ gameId: 'racing', hyper: { populationSize: 8 }, seed: 5 + _slot, seatCount: seats.length });
      learners.push(l);
      return l;
    },
  });

  check('four seats split between two models', session.seats.length === 2, JSON.stringify(session.seats));
  check(
    'every seat is dealt exactly once',
    session.seats.flat().sort((a, b) => a - b).join(',') === '0,1,2,3',
    session.seats.flat().join(','),
  );

  const generations = [0, 0];
  let steps = 0;
  while ((generations[0] === 0 || generations[1] === 0) && steps < 400_000) {
    for (const { slot } of session.step()) generations[slot]++;
    steps++;
  }
  check('both models complete a generation', generations[0] > 0 && generations[1] > 0, generations.join(' / '));
  check('both models learn from the same episodes', learners[0].envSteps > 0 && learners[1].envSteps > 0);
  check(
    'each model saves its own weights',
    learners[0].getWeights().length > 0 &&
      learners[0].getWeights().length === learners[1].getWeights().length,
    learners[0].getWeights().length + ' params each',
  );

  // The same episode run twice, changing only the table of car 0. Its score has
  // to move and car 1's must not, or a per-seat table is not really per seat.
  const run = (forgiveWalls: boolean): { car0: number; car1: number; hits: number } => {
    const env = new RacingEnv({ ...DEFAULT_RACING_CONFIG, nCars: 2, laps: 1, maxSteps: 400 }, careful);
    env.setAgentRewards(0, forgiveWalls ? { ...careful, wallHit: 0 } : careful);
    env.setAgentRewards(1, careful);
    env.reset(4);
    const actions = new Int32Array([0, 0]);
    let car0 = 0;
    let car1 = 0;
    for (let i = 0; i < 400; i++) {
      const res = env.step(actions);
      car0 += res.rewards[0];
      car1 += res.rewards[1];
      if (res.allDone) break;
    }
    return { car0, car1, hits: env.telemetry(0).wallHits };
  };
  const charged = run(false);
  const forgiven = run(true);
  check('the scripted car does hit walls, so the tables have something to differ about', charged.hits > 0, charged.hits + ' hits');
  check(
    'forgiving walls for one car raises only that car',
    forgiven.car0 > charged.car0 && Math.abs(forgiven.car1 - charged.car1) < 1e-4,
    charged.car0.toFixed(1) + ' -> ' + forgiven.car0.toFixed(1) + ', other car unchanged at ' + charged.car1.toFixed(1),
  );
}

// --------------------------------------------------------- chequered flag
/**
 * The car physics.
 *
 * Two promises. Version 1 never changes, by a single bit: every race card from
 * before version 2 replays on it, and a replay that drifts from the published
 * result is a championship nobody can trust. The fingerprints below are of the
 * position, heading and lap of four cars on random input, taken from the code
 * that raced those rounds.
 *
 * And on the current version a dumb driver loses. Flat out, steering at the
 * road ahead, used to be the fastest way round every circuit; now the tyres
 * have a limit, and a driver that never brakes is beaten by one that does.
 */
function physicsTest(): void {
  console.log(CHAPTER + 'car physics');

  const V1_FINGERPRINTS: Record<string, string> = {
    oval: 'feb5eb5d',
    kidney: 'd45b411d',
    technical: '8f6db783',
    speedway: '343aa7e7',
  };
  const f = new Float32Array(1);
  const u = new Uint32Array(f.buffer);
  for (const def of TRACK_DEFS) {
    const env = new RacingEnv(
      { ...DEFAULT_RACING_CONFIG, trackId: def.id, nCars: 4, laps: 3, physics: 1 },
      defaultRewards(RACING_SPEC),
    );
    env.reset(5);
    const rng = mulberry32(9);
    const act = new Int32Array(4);
    let h = 2166136261;
    for (let s = 0; s < 1500; s++) {
      for (let i = 0; i < 4; i++) act[i] = rng() < 0.7 ? Math.floor(rng() * 3) : Math.floor(rng() * 9);
      if (env.step(act).allDone) env.reset(s);
      for (const c of env.snapshot().cars) {
        for (const v of [c.x, c.y, c.angle]) {
          f[0] = v;
          h = Math.imul(h ^ u[0], 16777619) >>> 0;
        }
      }
    }
    const got = h.toString(16);
    check(`physics 1 is unchanged on ${def.id}`, got === V1_FINGERPRINTS[def.id], got);
  }

  for (const def of TRACK_DEFS) {
    const flat = drive(def.id, PHYSICS_VERSION, null);
    const brake = bestBraking(def.id, PHYSICS_VERSION);
    check(
      `flat out loses to braking on ${def.id}`,
      flatOutLoses(flat, brake),
      `${flat.totalMs === null ? 'DNF' : (flat.totalMs / 1000).toFixed(2) + 's'} (${flat.wallHits} walls) vs ${
        brake.totalMs === null ? 'DNF' : (brake.totalMs / 1000).toFixed(2) + 's'
      }`,
    );
  }

  const freePlay = new RacingEnv({ ...DEFAULT_RACING_CONFIG }, defaultRewards(RACING_SPEC));
  freePlay.reset(1);
  const go = new Int32Array(DEFAULT_RACING_CONFIG.nCars);
  let slid = false;
  for (let s = 0; s < 600 && !slid; s++) {
    go.fill(2); // gas and full right lock: more than any tyre can hold
    freePlay.step(go);
    slid = freePlay.snapshot().cars.some((c) => c.sliding);
  }
  check('training and play run on the current physics, where a car can slide', slid);

  check(
    'the championship switches physics at its round, not before',
    physicsForRound(PHYSICS_V2_ROUND - 1) === 1 && physicsForRound(PHYSICS_V2_ROUND) === PHYSICS_VERSION,
    `round ${PHYSICS_V2_ROUND}`,
  );
}

/**
 * The flag falls once, for everybody.
 *
 * When the leader completes the distance the race is over: the next car to reach
 * the line is classified there, on whatever lap it is on. Without this a session
 * runs until its slowest survivor drags itself home, and most of the broadcast is
 * one car alone on the circuit.
 */
function flagTest(): void {
  console.log(CHAPTER + 'the chequered flag');
  const n = 3;
  // Physics 1, where these scripted drivers were tuned: what is under test is
  // the flag, and it needs one car reliably laps down rather than in the wall.
  const env = new RacingEnv(
    { ...DEFAULT_RACING_CONFIG, trackId: 'oval', nCars: n, laps: 3, stuckLimit: 10 ** 9, maxSteps: 40000, physics: 1 },
    defaultRewards(RACING_SPEC),
  );
  env.reset(5);
  const obs = new Float32Array(OBS_SIZE);
  const act = new Int32Array(n);
  let steps = 0;
  for (; steps < 40000; steps++) {
    for (let i = 0; i < n; i++) {
      if (env.isAgentDone(i)) {
        act[i] = 4;
        continue;
      }
      env.observe(i, obs);
      const lateral = obs[11];
      const steer = lateral > 0.08 ? 2 : lateral < -0.08 ? 0 : 1;
      let throttle = obs[4] < 0.25 && obs[9] > 0.35 ? 2 : Math.abs(lateral) > 0.45 && obs[9] > 0.5 ? 1 : 0;
      // The last car dawdles: it brakes on most steps and is still laps down when
      // the leader is home.
      if (i === n - 1 && steps % 3 !== 0) throttle = 2;
      act[i] = throttle * 3 + steer;
    }
    if (env.step(act).allDone) break;
  }

  const cars = Array.from({ length: n }, (_, i) => env.telemetry(i));
  // The first car home, which is the one whose flag ends the race. Anybody still
  // on the final lap when it falls may of course complete the distance as well.
  const winner = cars
    .filter((c) => c.finished && c.laps === 3)
    .sort((a, b) => (a.totalMs ?? 0) - (b.totalMs ?? 0))[0] ?? null;
  const slow = cars[n - 1];
  check('somebody completes the full distance', winner !== null, `${cars.map((c) => c.laps).join('/')} laps`);
  check(
    'the car that was still out there is classified, laps down',
    slow.finished && slow.laps < 3 && slow.laps >= 1,
    `${slow.laps} of 3 laps, ${slow.finished ? 'flagged' : 'not flagged'}`,
  );
  check(
    'it was flagged after the first car was home, not before',
    (slow.totalMs ?? 0) > (winner?.totalMs ?? 0),
    `${(winner?.totalMs ?? 0).toFixed(0)}ms -> ${(slow.totalMs ?? 0).toFixed(0)}ms`,
  );
  check(
    'the race ends as soon as the last car is accounted for',
    env.step_ * STEP_MS < (slow.totalMs ?? 0) + 1000,
    `${(env.step_ * STEP_MS).toFixed(0)}ms of racing`,
  );

  // Laps first, then time: a car a lap down is behind everyone on the lead lap,
  // however quickly it reached the line.
  const order = env.snapshot().order;
  const keys = order.map((car) => {
    const t = env.telemetry(car);
    return { laps: t.laps, ms: t.totalMs ?? Infinity };
  });
  check(
    'the classification is laps first, then time',
    keys.every((k, i) => i === 0 || k.laps < keys[i - 1].laps || (k.laps === keys[i - 1].laps && k.ms >= keys[i - 1].ms)),
    keys.map((k) => `${k.laps}L/${k.ms === Infinity ? 'dnf' : k.ms.toFixed(0)}`).join(' '),
  );

  // A lapped car must not take the win by crossing the line a moment after the
  // leader: that is exactly what ordering on raw finish time would do.
  check('the winner is classified first', env.telemetry(order[0]).laps === 3);
}

// ------------------------------------------------------------- lap timing
/**
 * A scripted driver's times must be self-consistent: sectors add up to the lap,
 * laps add up to the race, and the lap clock starts at the line rather than on
 * the grid. Every number the championship reports rests on these.
 */
function timingTest(): void {
  console.log('\nlap and race timing');
  const env = new RacingEnv(
    { ...DEFAULT_RACING_CONFIG, trackId: 'oval', nCars: 1, laps: 3, stuckLimit: 900, maxSteps: 20000 },
    defaultRewards(RACING_SPEC),
  );
  env.reset(1);
  const obs = new Float32Array(OBS_SIZE);
  const act = new Int32Array(1);
  for (let s = 0; s < 20000; s++) {
    env.observe(0, obs);
    const lateral = obs[11];
    const steer = lateral > 0.08 ? 2 : lateral < -0.08 ? 0 : 1;
    const throttle = obs[4] < 0.25 && obs[9] > 0.35 ? 2 : Math.abs(lateral) > 0.45 && obs[9] > 0.5 ? 1 : 0;
    act[0] = throttle * 3 + steer;
    if (env.step(act).allDone) break;
  }

  const t = env.telemetry(0);
  check('the scripted driver completes the distance', t.finished && t.laps === 3, `${t.laps} laps`);
  check('one lap time per lap', t.lapTimesMs.length === 3, String(t.lapTimesMs.length));

  const sectorErr = t.sectorTimesMs.map((row, i) => Math.abs(row.reduce((a, b) => a + b, 0) - t.lapTimesMs[i]));
  check('sectors sum to their lap', Math.max(...sectorErr) < 1e-6, `max error ${Math.max(...sectorErr).toExponential(1)}ms`);

  // Race time runs from lights out and so includes the run up to the line, which
  // the sum of the flying laps does not.
  const lapSum = t.lapTimesMs.reduce((a, b) => a + b, 0);
  const runUp = (t.totalMs ?? 0) - lapSum;
  check('race time is the laps plus the run to the line', runUp > 0 && runUp < 2000, `run-up ${runUp.toFixed(0)}ms`);
  check('best lap is the quickest of them', t.bestLapMs === Math.min(...t.lapTimesMs), `${(t.bestLapMs ?? 0).toFixed(0)}ms`);
  check('a step is 1/60 of a second', Math.abs(STEP_MS - 1000 / 60) < 1e-12);
  check('the finisher is classified first', env.snapshot().order[0] === 0);

  // Regression: the classification used to be sorted on checkpoint count. Every
  // car that completes the distance has the identical count, so the tie fell to
  // the lowest index — which in a race against a model is the human. The screen
  // cheerfully announced a win to a player who had just been beaten by nine
  // seconds. Rank has to come from *when* the flag was taken.
  // Physics 1 for the same reason as the flag test: the scenario needs every
  // car home on the lead lap, which these scripted drivers manage there.
  const duel = new RacingEnv(
    { ...DEFAULT_RACING_CONFIG, trackId: 'oval', nCars: 3, laps: 2, stuckLimit: 10 ** 9, maxSteps: 40000, physics: 1 },
    defaultRewards(RACING_SPEC),
  );
  duel.reset(5);
  const duelAct = new Int32Array(3);
  for (let step = 0; step < 40000; step++) {
    for (let i = 0; i < 3; i++) {
      if (duel.isAgentDone(i)) {
        duelAct[i] = 4;
        continue;
      }
      duel.observe(i, obs);
      const lateral = obs[11];
      const steer = lateral > 0.08 ? 2 : lateral < -0.08 ? 0 : 1;
      let throttle = obs[4] < 0.25 && obs[9] > 0.35 ? 2 : Math.abs(lateral) > 0.45 && obs[9] > 0.5 ? 1 : 0;
      // Car 0 drives deliberately badly, the way a human usually does.
      if (i === 0 && step % 3 === 0) throttle = 2;
      duelAct[i] = throttle * 3 + steer;
    }
    if (duel.step(duelAct).allDone) break;
  }

  const order = duel.snapshot().order;
  const times = order.map((car) => duel.telemetry(car).totalMs);
  check('everyone took the flag', times.every((t) => t !== null), times.map((t) => (t ?? 0).toFixed(0)).join(', '));
  check(
    'the classification is in time order, not index order',
    times.every((t, i) => i === 0 || (t ?? 0) >= (times[i - 1] ?? 0)),
    `order ${order.join(',')}`,
  );
  check('the slowest car is not declared the winner', order[0] !== 0, `car 0 finished ${((times[order.indexOf(0)] ?? 0) / 1000).toFixed(2)}s`);
}

// ----------------------------------------------------------- championship
/**
 * The rules of the competition, checked without simulating anything: how a field
 * is divided, how points are handed out, and how a tie is broken. These are the
 * parts players will argue about, so they are worth pinning down.
 */
function championshipTest(): void {
  console.log('\nchampionship rules');

  check('a small field races in one go', planSessions(seedIds(GRID_SIZE)).length === 1, `${GRID_SIZE} entries`);
  const twoHeats = planSessions(seedIds(GRID_SIZE + 1));
  check('one over the grid becomes heats plus a final', twoHeats.length === 3 && twoHeats[2].kind === 'final');
  check(
    'heats are seeded without losing anyone',
    new Set(twoHeats.slice(0, 2).flatMap((s) => s.grid)).size === GRID_SIZE + 1,
  );

  const big = planSessions(seedIds(60));
  const rounds = new Set(big.map((s) => s.round)).size;
  check(
    'a huge field is whittled down over rounds',
    rounds >= 3 && big[big.length - 1].kind === 'final',
    `${big.length} sessions, ${rounds} rounds`,
  );
  check('no session is bigger than the grid', big.every((s) => s.grid.length <= GRID_SIZE));

  // The two scoring rules that catch people out: the fastest-lap bonus only
  // counts inside the top ten, and a car that did not go the distance scores
  // nothing whatever position it was classified in.
  const places = awardPoints(
    [
      { entryId: 'a', position: 1, eliminatedIn: null, status: 'finished', laps: RACE_LAPS },
      { entryId: 'b', position: 2, eliminatedIn: null, status: 'finished', laps: RACE_LAPS },
      { entryId: 'c', position: 3, eliminatedIn: null, status: 'dnf', laps: 1 },
      { entryId: 'd', position: 11, eliminatedIn: null, status: 'finished', laps: RACE_LAPS },
    ],
    'd',
    RACE_LAPS,
  );
  const pts = (id: string) => places.find((p) => p.entryId === id)!.points;
  check('the winner takes 25', pts('a') === POINTS[0], String(pts('a')));
  check('too little distance covered scores nothing', pts('c') === 0 && !places[2].classified);
  check('the fastest lap outside the top ten earns no bonus', pts('d') === 0, String(pts('d')));

  const cards: RaceCard[] = [1, 2].map((round) => fakeCard(round, ['a', 'b']));
  const level = buildStandings({
    cards,
    results: new Map([
      [cards[0].id, fakeResult(cards[0].id, [fakePlace('a', 1), fakePlace('b', 2)])],
      [cards[1].id, fakeResult(cards[1].id, [fakePlace('b', 1), fakePlace('a', 2)])],
    ]),
  });
  check('a win each leaves them level on points', level.drivers[0].points === level.drivers[1].points, `${level.drivers[0].points}`);

  const won = buildStandings({
    cards,
    results: new Map([
      [cards[0].id, fakeResult(cards[0].id, [fakePlace('a', 1), fakePlace('b', 2)])],
      [cards[1].id, fakeResult(cards[1].id, [fakePlace('a', 1), fakePlace('b', 2)])],
    ]),
  });
  check('more wins takes the title', won.drivers[0].entryId === 'a' && won.drivers[0].wins === 2);
  check('teams add up their drivers', won.teams[0].points === won.drivers[0].points, `${won.teams[0].points}`);

  // Names published to the arena appear on a leaderboard everyone reads, so the
  // shapes that break one are rejected before they get there.
  const nameOk = ['גיא', 'Speedy', 'רכב 7', 'A-Team', 'Mr.Bean', 'v2.0'];
  const nameBad = [
    'א',
    'x'.repeat(NAME_MAX + 1),
    'bit.ly/x',
    'bit.ly',
    'example.com',
    'me@example.com',
    '....',
    '‮גיא',
    '   ',
  ];
  check('real names pass', nameOk.every(isNameOk), nameOk.join(', '));
  // One team name, one owner: spellings that read as the same name share a claim.
  check('case and spacing are the same team name', nameKey('Rotshild') === nameKey('  rotSHILD ') && nameKey('A  Team') === nameKey('a team'));
  check('different names are different claims', nameKey('Rotshild') !== nameKey('Rotshild2') && nameKey('גיא') !== nameKey('גאי'));
  check('a slash cannot escape the registry', !nameKey('a/b').includes('/'));
  check(
    'too short, too long, links, emails and bidi overrides are rejected',
    nameBad.every((n) => !isNameOk(n)),
    nameBad.filter(isNameOk).join(', ') || 'all rejected',
  );
  check('surrounding whitespace is not a name', normalizeName('  גיא  ') === 'גיא');

  // The calendar rotates through the circuits, which is what makes a track
  // record worth chasing. `nextRoundOnTrack` must always name the *earliest*
  // future round on that track.
  let rotationBad = 0;
  for (let after = 0; after < 24; after++) {
    for (const def of TRACK_DEFS) {
      const next = nextRoundOnTrack(def.id, after);
      if (next === null || next <= after || trackForRound(next) !== def.id) rotationBad++;
      else for (let k = after + 1; k < next; k++) if (trackForRound(k) === def.id) rotationBad++;
    }
  }
  check('every circuit comes round again, and the next date is the nearest one', rotationBad === 0, `${TRACK_DEFS.length} circuits`);
  check('consecutive rounds are on different circuits', trackForRound(1) !== trackForRound(2));

  // A model that parks must not hold the race open. In a championship session
  // the stuck limit retires it; the session then ends on its own, which is what
  // keeps a broadcast inside its slot on the schedule instead of running until
  // the step cap with nothing happening.
  const stuck = new RacingEnv(
    { trackId: 'oval', nCars: 3, laps: RACE_LAPS, carCollisions: true, maxSteps: RACE_LAPS * 900 + 600, stuckLimit: 480 },
    defaultRewards(RACING_SPEC),
  );
  stuck.reset(3);
  const stuckObs = new Float32Array(OBS_SIZE);
  const stuckAct = new Int32Array(3);
  let endedAt = -1;
  for (let step = 0; step < 20000; step++) {
    // Car 0 drives; the other two do nothing at all.
    stuck.observe(0, stuckObs);
    const lateral = stuckObs[11];
    stuckAct[0] = (stuckObs[4] < 0.25 && stuckObs[9] > 0.35 ? 2 : 0) * 3 + (lateral > 0.08 ? 2 : lateral < -0.08 ? 0 : 1);
    stuckAct[1] = 7; // brake, straight
    stuckAct[2] = 7;
    if (stuck.step(stuckAct).allDone) {
      endedAt = step;
      break;
    }
  }
  check('a parked car is retired, not waited on', stuck.telemetry(1).dnf && stuck.telemetry(2).dnf);
  check(
    'the session ends by itself well inside its broadcast slot',
    endedAt > 0 && endedAt * STEP_MS < SESSION_GAP_MS,
    `${(endedAt * STEP_MS / 1000).toFixed(0)}s of a ${SESSION_GAP_MS / 1000}s slot`,
  );

  // The same limit, applied to a race against a human: the models retire, the
  // player never does. Without the exemption a player parked to read the
  // standings would be thrown out of their own race.
  const duelCfg = getGame('racing').raceConfig({ ...DEFAULT_RACING_CONFIG, laps: 2 }, 1) as never;
  const duel = new RacingEnv(duelCfg, defaultRewards(RACING_SPEC));
  duel.reset(4);
  const idle = new Int32Array(2).fill(7); // both cars braking, going nowhere
  for (let step = 0; step < 4000; step++) duel.step(idle);
  check('a model that beaches itself is retired', duel.isAgentDone(1));
  check('the player is never retired for standing still', !duel.isAgentDone(0));

  const gap = startsAtForRound(4) - startsAtForRound(3);
  check('rounds are exactly a day apart', gap === DAY_MS, `${gap / 3_600_000}h`);

  // 20:00 in Israel, every day, checked against the real zone database.
  const israelHour = (at: number) =>
    Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' }).format(at));
  const offHours: number[] = [];
  for (let r = 1; r <= 365 * 5; r++) if (israelHour(startsAtForRound(r)) !== 20) offHours.push(r);
  check('every round for five years starts at 20:00 Israel time', offHours.length === 0, offHours.slice(0, 5).join(', '));
  const alreadyRaced: number[] = [];
  for (let r = 1; r <= 41; r++) {
    if (startsAtForRound(r) !== Date.UTC(2026, 8, 14 + r - 1, 17)) alreadyRaced.push(r);
  }
  check('rounds up to the clock change keep their old start, 17:00 UTC', alreadyRaced.length === 0, alreadyRaced.join(', '));
  const sunday = startsAtForRound(42);
  check('round 42, Sunday 25.10, is the first at 18:00 UTC', sunday === Date.UTC(2026, 9, 25, 18));
  check('and the evening before it is round 41', currentRound(sunday - 1) === 41 && currentRound(sunday) === 42);
  let monotonic = true;
  for (let r = 1; r < 365 * 3; r++) {
    const at = startsAtForRound(r);
    if (currentRound(at) !== r || currentRound(at - 1) !== r - 1) monotonic = false;
  }
  check('the current round turns over exactly at each lights out, clock changes included', monotonic);
  check('nothing is raced before the season opens', currentRound(startsAtForRound(1) - 1) === 0);
  check('round one opens on time', currentRound(startsAtForRound(1)) === 1);
}

function seedIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `e${i}`);
}

function fakeCard(round: number, entryIds: string[]): RaceCard {
  return {
    id: `R${round}`,
    seasonId: 'S1',
    round,
    name: `race ${round}`,
    trackId: 'oval',
    laps: RACE_LAPS,
    seed: round,
    startsAt: startsAtForRound(round),
    entries: entryIds.map((id) => ({
      id,
      // One account per team, as it is in the real arena.
      uid: id === 'a' ? 'u' : 'u-beta',
      driver: id,
      team: id === 'a' ? 'Alpha' : 'Beta',
      gameId: 'racing',
      algorithm: 'ga' as const,
      arch: { obsSize: OBS_SIZE, hidden: [8], nActions: 9 },
      obsVersion: RACING_SPEC.obsVersion,
      tag: id.toUpperCase(),
      createdAt: 0,
      updatedAt: 0,
      modelId: id,
      episodes: 1,
    })),
    qualifying: entryIds.map((id) => ({ entryId: id, bestLapMs: 1000, sectorsMs: [null, null, null], topSpeed: 1 })),
    createdAt: 0,
  };
}

function fakePlace(entryId: string, position: number): DayPlace {
  return {
    entryId,
    position,
    points: POINTS[position - 1] ?? 0,
    eliminatedIn: null,
    status: 'finished',
    classified: true,
  };
}

function fakeResult(raceId: string, places: DayPlace[]): RaceResult {
  return { raceId, seasonId: 'S1', computedAt: 0, sessions: [], places, pole: null, fastestLap: null };
}

// ------------------------------------------------------- split drivers
/**
 * One driver, two entries.
 *
 * A car is meant to keep its entry for the whole season, but a delete and a
 * re-registration, or a model re-imported under a new id, could give the same
 * driver a second one — and then half the season's points sat in each, two rows
 * apart in the table. History cannot be rewritten to fix it (cards and results
 * are create-only and name the entry that actually raced), so the table itself
 * has to put the pieces back together.
 */
function splitDriverTest(): void {
  console.log(CHAPTER + 'a driver split across two entries');

  const asDriver = (card: RaceCard, driver: string, team = 'Alpha', uid = 'u'): RaceCard => ({
    ...card,
    entries: card.entries.map((e) => ({ ...e, driver, team, uid })),
  });

  const first = asDriver(fakeCard(1, ['old']), 'Flesh Blood');
  const second = asDriver(fakeCard(2, ['new']), 'Flesh Blood');
  const results = new Map([
    [first.id, fakeResult(first.id, [fakePlace('old', 1)])],
    [second.id, fakeResult(second.id, [fakePlace('new', 1)])],
  ]);

  const merged = buildStandings({ cards: [first, second], results });
  check('the same driver is one row, not two', merged.drivers.length === 1, `${merged.drivers.length} rows`);
  check(
    'both entries keep their points',
    merged.drivers[0].points === POINTS[0] * 2 && merged.drivers[0].wins === 2,
    `${merged.drivers[0].points} pts`,
  );
  check(
    'the row is the car that is still on the grid',
    merged.drivers[0].entryId === 'new' && merged.drivers[0].entryIds.join(',') === 'old,new',
  );
  check(
    'every race the driver ran is still in the grid of results',
    Object.keys(merged.drivers[0].byRace).sort().join(',') === [first.id, second.id].sort().join(','),
  );

  // A rename is the case that makes this a union rather than a lookup: the old
  // entry raced under one name and the new one under the name it was renamed to.
  const renamed = [asDriver(fakeCard(1, ['old']), 'WOW'), asDriver(fakeCard(2, ['old']), 'WOW v2'), asDriver(fakeCard(3, ['new']), 'WOW v2')];
  const afterRename = buildStandings({
    cards: renamed,
    results: new Map(
      renamed.map((c, i) => [c.id, fakeResult(c.id, [fakePlace(i === 2 ? 'new' : 'old', 1)])]),
    ),
  });
  check(
    'a rename does not split a driver, and still catches the duplicate',
    afterRename.drivers.length === 1 && afterRename.drivers[0].points === POINTS[0] * 3,
    `${afterRename.drivers.length} rows`,
  );

  // One team on two accounts — an anonymous identity left behind in another
  // browser — is one driver, and one team.
  const leftBehind = asDriver(fakeCard(1, ['anon']), 'wow', 'Rotshild', 'anonymous');
  const signedIn = asDriver(fakeCard(2, ['google']), 'wow', 'Rotshild', 'google');
  const twoAccounts = buildStandings({
    cards: [leftBehind, signedIn],
    results: new Map([
      [leftBehind.id, fakeResult(leftBehind.id, [fakePlace('anon', 1)])],
      [signedIn.id, fakeResult(signedIn.id, [fakePlace('google', 1)])],
    ]),
  });
  check(
    'one team on two accounts keeps one row per driver',
    twoAccounts.drivers.length === 1 && twoAccounts.drivers[0].points === POINTS[0] * 2 && twoAccounts.drivers[0].entryId === 'google',
    `${twoAccounts.drivers.length} rows`,
  );
  check('and is one team', twoAccounts.teams.length === 1 && twoAccounts.teams[0].points === POINTS[0] * 2);

  // The safety rail: two people are allowed the same model name, and merging
  // their points would be far worse than showing a split.
  const mine = asDriver(fakeCard(1, ['mine']), 'Flesh Blood');
  const theirs = asDriver(fakeCard(2, ['theirs']), 'Flesh Blood', 'Beta', 'someone-else');
  const twoPeople = buildStandings({
    cards: [mine, theirs],
    results: new Map([
      [mine.id, fakeResult(mine.id, [fakePlace('mine', 1)])],
      [theirs.id, fakeResult(theirs.id, [fakePlace('theirs', 1)])],
    ]),
  });
  check('one model name in two teams is two drivers', twoPeople.drivers.length === 2);
  check('and two teams', twoPeople.teams.length === 2, `${twoPeople.teams.length} teams`);

  // Renaming the team is a label change: the driver stays one row, the team
  // stays one team, and it shows the newest name.
  const beforeRename = asDriver(fakeCard(1, ['car']), 'Flesh Blood', 'Alpha');
  const afterTeamRename = asDriver(fakeCard(2, ['car']), 'Flesh Blood', 'Omega');
  const teamRenamed = buildStandings({
    cards: [beforeRename, afterTeamRename],
    results: new Map([
      [beforeRename.id, fakeResult(beforeRename.id, [fakePlace('car', 1)])],
      [afterTeamRename.id, fakeResult(afterTeamRename.id, [fakePlace('car', 1)])],
    ]),
  });
  check(
    'a team rename keeps one driver and one team, under the new name',
    teamRenamed.drivers.length === 1 && teamRenamed.teams.length === 1 && teamRenamed.teams[0].team === 'Omega',
    `${teamRenamed.drivers.length} drivers, ${teamRenamed.teams.map((t) => t.team).join('/')}`,
  );

  // Both cars of a split driver on one grid: nothing invented, nothing dropped.
  const together = asDriver(fakeCard(4, ['old', 'new']), 'Flesh Blood');
  const sameRace = buildStandings({
    cards: [together],
    results: new Map([
      [together.id, fakeResult(together.id, [fakePlace('old', 2), fakePlace('new', 5)])],
    ]),
  });
  check(
    'two cars of one driver in one race add up, and show the better finish',
    sameRace.drivers.length === 1 &&
      sameRace.drivers[0].byRace[together.id].points === POINTS[1] + POINTS[4] &&
      sameRace.drivers[0].byRace[together.id].position === 2,
    `${sameRace.drivers[0].byRace[together.id].points} pts`,
  );
}

// ----------------------------------------------------------- team limit
/**
 * Two cars per team, on the grid as well as in the garage.
 *
 * The garage refuses to register a third, but teams that were already over the
 * limit when the rule came in still have their entries, so the field itself has
 * to apply it — and it has to be the same two for everybody, or two clients
 * would build two different race cards.
 */
function teamLimitTest(): void {
  console.log(CHAPTER + 'two cars per team');
  const round = 1;
  const before = lockAtForRound(round) - 1000;
  const entries = ['a', 'b', 'c', 'd'].map((id, i) => ({
    ...fakeCard(round, [id]).entries[0],
    id,
    uid: 'u',
    team: 'Alpha',
    createdAt: before - (4 - i) * 1000,
  }));
  entries.push({ ...fakeCard(round, ['z']).entries[0], id: 'z', uid: 'other', team: 'Beta', createdAt: before });

  const field = eligibleEntries(entries, round);
  const alpha = field.filter((e) => e.team === 'Alpha');
  check('a team fields at most two cars', alpha.length === MAX_CARS_PER_TEAM, field.map((e) => e.id).join(','));
  check('the two that registered first are the ones that race', alpha.map((e) => e.id).join(',') === 'a,b');
  check('other teams are untouched', field.some((e) => e.id === 'z'));
  check(
    'the same field comes out whatever order the entries arrive in',
    eligibleEntries([...entries].reverse(), round).map((e) => e.id).join(',') === field.map((e) => e.id).join(','),
  );

  // One team on two accounts: an identity left behind in another browser still
  // wears the team's name. It is one team with two seats, and the seats go to
  // the account the team races from now, not to the cars nobody can reach.
  const older = ['x1', 'x2'].map((id, i) => ({
    ...fakeCard(round, [id]).entries[0],
    id,
    uid: 'left-behind',
    team: 'Alpha',
    createdAt: before - 10_000 - i,
    updatedAt: before - 10_000,
  }));
  const current = entries.slice(0, 2).map((e) => ({ ...e, updatedAt: before }));
  const shared = eligibleEntries([...older, ...current], round).map((e) => e.id);
  check('one team name on two accounts is one team, with two seats', shared.length === MAX_CARS_PER_TEAM, shared.join(','));
  check('and the seats go to the account in use, not the one left behind', shared.join(',') === 'a,b', shared.join(','));
  const oneLeft = eligibleEntries([...older, current[0]], round).map((e) => e.id);
  check('a seat the current account leaves empty is filled from the old one', oneLeft.join(',') === 'x2,a', oneLeft.join(','));
  const renamed = entries.slice(0, 3).map((e, i) => ({ ...e, team: i === 2 ? 'Alpha Renamed' : e.team }));
  check(
    'a second name does not buy a third car',
    eligibleEntries(renamed, round).length === MAX_CARS_PER_TEAM,
  );
}

// ------------------------------------------------------- the team name
/**
 * Which name wins when the browser and the account disagree.
 *
 * The team name used to live only in localStorage, which made a second device
 * ask for it again — and a slightly different spelling is a different
 * constructor, with the season's points split across two rows of the teams'
 * table. It lives with the account now, and this is the rule that merges the
 * two copies.
 */
function competitorTest(): void {
  console.log(CHAPTER + 'the team name across devices');

  const fresh = resolveCompetitor('', 'גיא');
  check('a new device takes the name from the account', fresh.adopt === 'גיא' && fresh.push === null);

  const first = resolveCompetitor('גיא', '');
  check('an account with no name yet gets the one already typed', first.push === 'גיא' && first.adopt === null);

  const same = resolveCompetitor('גיא', 'גיא');
  check('agreement writes nothing anywhere', same.adopt === null && same.push === null);

  const renamed = resolveCompetitor('גיא', 'גיא מוטורספורט');
  check(
    'a rename on another device wins here too',
    renamed.adopt === 'גיא מוטורספורט' && renamed.push === null,
  );

  const nothing = resolveCompetitor('', '');
  check('with nothing anywhere, nothing is invented', nothing.adopt === null && nothing.push === null);

  const spaced = resolveCompetitor('  גיא  ', 'גיא');
  check('whitespace is not a different team', spaced.adopt === null && spaced.push === null);
}

// ------------------------------------------------------- broadcast clock
/**
 * A race day has two kinds of dead time, and both used to be shown as a clock
 * counting up: the gap between the flag and the next session's lights, and the
 * tail of the final's slot after the championship has already been decided.
 * What the viewer needs instead is a countdown to the next session, and the
 * tables the moment the last car is home.
 */
function broadcastClockTest(): void {
  console.log(CHAPTER + 'the clock between sessions');
  // Eighteen entrants: two heats and a final, three minutes apart.
  const card = fakeCard(1, seedIds(18));
  const windows = sessionWindows(card);
  check('eighteen entrants make two heats and a final', windows.length === 3, windows.map((w) => w.session.name).join(' · '));

  // Racing that fills 40 seconds of a 180-second slot.
  const RACING_MS = 40_000;
  const result: RaceResult = {
    raceId: card.id,
    seasonId: 'S1',
    computedAt: 0,
    sessions: windows.map((w) => ({
      sessionId: w.session.id,
      grid: [],
      classification: [
        {
          entryId: 'e0',
          position: 1,
          laps: 6,
          totalMs: RACING_MS,
          gapMs: null,
          bestLapMs: 6000,
          bestSectorsMs: [null, null, null],
          lapTimesMs: [],
          lapPositions: [],
          topSpeed: 5,
          overtakes: 0,
          wallHits: 0,
          carHits: 0,
          lapsLed: 6,
          status: 'finished' as const,
          gridPos: 1,
        },
      ],
      fastestLap: null,
    })),
    places: [],
    pole: null,
    fastestLap: null,
  };

  const start = windows[0].startsAt;
  const racing = dayStatus(card, result, start + 10_000);
  check('while the cars are out there the day is racing', racing.phase === 'racing', racing.phase);

  const between = dayStatus(card, result, start + RACING_MS + 5000);
  check('after the flag it is between sessions, not still racing', between.phase === 'interval', between.phase);
  check(
    'and it knows which session is next, so there is something to count down to',
    between.next?.session.id === windows[1].session.id,
    between.next?.session.name ?? 'none',
  );
  check(
    'the countdown is shorter than the slot it sits in',
    (between.next?.startsAt ?? 0) - (start + RACING_MS) < SESSION_GAP_MS,
    `${Math.round(((between.next?.startsAt ?? 0) - (start + RACING_MS)) / 1000)}s`,
  );
  check(
    'the heat that just ended can be read straight away',
    between.finished.has(windows[0].session.id) && !between.finished.has(windows[1].session.id),
    [...between.finished].join(','),
  );

  // The final: the day ends with the flag, not with the end of its slot.
  const finalStart = windows[2].startsAt;
  const justAfterFinal = finalStart + RACING_MS + 1000;
  check(
    'the day is over the moment the final is flagged',
    dayStatus(card, result, justAfterFinal).phase === 'done',
    `${Math.round((windows[2].endsAt - justAfterFinal) / 1000)}s of slot still unused`,
  );
  check('and the results open with it', resultsVisible(card, justAfterFinal, result));
  check(
    'the tables count the day only once it is over',
    settledResults([card], new Map([[card.id, result]]), justAfterFinal).size === 1 &&
      settledResults([card], new Map([[card.id, result]]), start + 10_000).size === 0,
  );
  // Without a stored result there is nothing to shorten the day with, so the
  // slots stand as planned rather than the day ending early on a guess.
  check(
    'a day with no result yet still runs its full schedule',
    dayStatus(card, null, justAfterFinal).phase === 'racing',
    dayStatus(card, null, justAfterFinal).phase,
  );
}

// ------------------------------------------------------------ default names
/**
 * The generator promises that *every* name it can produce is fit for a public
 * leaderboard, so the check is the whole cross product rather than a sample.
 * A word added to either list without reading the rules fails right here.
 */
function nameGenTest(): void {
  console.log('\ndefault model names');

  const bad: string[] = [];
  let longest = '';
  for (const adjective of NAME_ADJECTIVES)
    for (const noun of NAME_NOUNS) {
      const name = `${adjective} ${noun}`;
      if (!isCleanName(name)) bad.push(name);
      if (name.length > longest.length) longest = name;
    }
  const pairs = NAME_ADJECTIVES.length * NAME_NOUNS.length;
  check(
    `all ${pairs} pairs are clean, and none is longer than NAME_MAX`,
    bad.length === 0,
    bad.slice(0, 6).join(', ') || `longest is "${longest}" at ${longest.length} of ${NAME_MAX}`,
  );

  const words = [...NAME_ADJECTIVES, ...NAME_NOUNS];
  const dupes = words.filter((w, i) => words.indexOf(w) !== i);
  check('no word is listed twice', dupes.length === 0, dupes.join(', ') || `${words.length} words`);

  const shape = words.filter((w) => !/^[A-Z][a-z]{2,10}$/.test(w));
  check('every word is a single capitalised English word', shape.length === 0, shape.join(', '));

  // Four models can train on one grid, and four cars called the same thing is
  // a grid nobody can read.
  const grid: string[] = [];
  const gridRng = mulberry32(5);
  for (let i = 0; i < 4; i++) grid.push(randomModelName(gridRng, grid));
  check('a full grid draws four different names', new Set(grid).size === 4, grid.join(' · '));

  const avoid = ['Swift Falcon', 'Lone Otter'];
  const avoidRng = mulberry32(11);
  let leaked = 0;
  const drawn = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const name = randomModelName(avoidRng, avoid);
    drawn.add(name);
    if (avoid.includes(name)) leaked++;
  }
  check('a name the caller ruled out is never drawn', leaked === 0, `${leaked} leaked`);
  // A generator that keeps handing back the same fifty names is broken in a
  // way every other check here would pass.
  check('2000 draws spread across the lists', drawn.size > 800, `${drawn.size} distinct`);
}

// --------------------------------------------------------------- early feed
/**
 * The feed opens before the lights.
 *
 * What has to hold is a pair of opposites: a way into the broadcast exists
 * before the start, and nothing about the race itself moves an inch earlier.
 * The day is still 'upcoming', the results are still sealed, and the session
 * the viewer is let into has not started — they are watching a countdown on a
 * stationary grid.
 */
function earlyFeedTest(): void {
  console.log(CHAPTER + 'the feed opens before the lights');
  const card = fakeCard(1, seedIds(6));
  const start = sessionWindows(card)[0].startsAt;
  const opens = broadcastOpensAt(card);

  check(
    'the feed opens a minute before the lights',
    start - opens === BROADCAST_OPENS_MS,
    `${(start - opens) / 1000}s`,
  );
  // Everyone has to build the same card, so the field must already be frozen
  // when the first client builds it for the feed.
  check(
    'and only after the entry list has closed',
    BROADCAST_OPENS_MS < LOCK_BEFORE_MS,
    `opens ${BROADCAST_OPENS_MS / 1000}s out, locks ${LOCK_BEFORE_MS / 1000}s out`,
  );

  check('a second before it opens there is nothing to watch', dayState(card, opens - 1000) === 'upcoming');
  check('the moment it opens the day counts as on air', dayState(card, opens) === 'live');
  check('and it still is once the race is running', dayState(card, start + 1000) === 'live');

  // The way in appears early; the race does not start early.
  check('the race has not started with it', dayStatus(card, null, opens).phase === 'upcoming');
  check('and no result is readable yet', !resultsVisible(card, opens, null));

  const joined = liveSession(card, opens);
  check('the viewer is let into the first session', joined?.session.id === sessionWindows(card)[0].session.id);
  check(
    'whose lights are still ahead of them',
    joined !== null && joined.startsAt > opens,
    `${((joined?.startsAt ?? 0) - opens) / 1000}s to go`,
  );
  check('nobody is let in before that', liveSession(card, opens - 1) === null);

  // The round on air is what makes the client build tomorrow's card in time.
  const r = 4;
  const lights = startsAtForRound(r);
  check('the round about to start is the one on air', airingRound(lights - BROADCAST_OPENS_MS) === r, `${r}`);
  check('a moment earlier it is still yesterday', airingRound(lights - BROADCAST_OPENS_MS - 1) === r - 1);
  check('and at the lights it is the round itself', airingRound(lights) === r);
}

// --------------------------------------------------------------- first run
/**
 * The walkthrough is a pure function of where the account actually is, so the
 * ladder can be checked here instead of by clicking through the app six times.
 * The two ends matter most: somebody who has just arrived is told the first
 * thing to do, and somebody with a car on the grid is never spoken to again.
 */
function coachTest(): void {
  console.log(CHAPTER + 'the first-run guide');
  const base: CoachState = { screen: 'championship', competitor: '', models: null, registered: false };
  const at = (over: Partial<CoachState>) => coachStepFor({ ...base, ...over });

  check('a brand new visitor is sent to the name field', at({}) === 'name', String(at({})));
  check(
    'whitespace is not a team name',
    at({ competitor: '   ', models: 0 }) === 'name',
    String(at({ competitor: '   ', models: 0 })),
  );

  const named = { competitor: 'Guy' };
  check('with a name and nothing built, the garage tab is next', at({ ...named, models: 0 }) === 'garage');
  check('inside the garage it is the button that makes one', at({ ...named, models: 0, screen: 'library' }) === 'create');
  check('setting a run up, it is the button that starts it', at({ ...named, models: 0, screen: 'trainSetup' }) === 'setup');
  check('while it trains, it is finish and save', at({ ...named, models: 0, screen: 'training' }) === 'save');
  check('a saved model in the garage gets the register button', at({ ...named, models: 1, screen: 'library' }) === 'enter');
  check('and from anywhere else, the garage tab again', at({ ...named, models: 1 }) === 'unregistered');

  // Nothing is said while the library is still being read: a bubble that
  // guesses wrong and then swaps itself out reads as a glitch.
  check('nothing is guessed before the library is read', at({ ...named, models: null }) === null);

  const screens: CoachState['screen'][] = [
    'championship', 'standings', 'broadcast', 'report', 'library',
    'trainSetup', 'training', 'raceSetup', 'race', 'info',
  ];
  const spoken = screens.filter((screen) => at({ ...named, models: 2, registered: true, screen }) !== null);
  check('a car on the grid ends the walkthrough everywhere', spoken.length === 0, spoken.join(', ') || 'silent');

  // Someone watching a race or reading the terms is left alone, even mid-guide.
  const quiet = (['broadcast', 'report', 'race', 'info'] as CoachState['screen'][]).filter(
    (screen) => at({ ...named, models: 0, screen }) !== null,
  );
  check('and nobody is nudged over a race or the rules', quiet.length === 0, quiet.join(', ') || 'silent');

  // Withdrawing a car puts the guide back: it follows the state, not a counter.
  check('withdrawing a car brings it back', at({ ...named, models: 1, screen: 'library' }) === 'enter');
}

// ---------------------------------------------------------------- metrics
function metricsTest(): void {
  console.log(CHAPTER + 'Retention metrics');
  const row = (uid: string, day: string, event: MetricRow['event'] = 'visit'): MetricRow => ({ uid, event, day });
  const rows: MetricRow[] = [
    // a: back the next day and a month later.
    row('a', '2026-09-01'), row('a', '2026-09-02'), row('a', '2026-10-05'), row('a', '2026-09-01', 'enter'),
    // b: never back.
    row('b', '2026-09-01'),
    // c: back after a week, on a later day only — and exactly 30 days old today.
    row('c', '2026-09-10'), row('c', '2026-09-20'), row('c', '2026-09-10', 'train'),
    // d: arrived yesterday — too new to count as lost on day 7.
    row('d', '2026-10-09'),
  ];
  const s = summarize(rows, '2026-10-10');
  const at = (d: number) => s.retention.find((r) => r.day === d)!;
  check('every account is counted once', s.accounts === 4, String(s.accounts));
  check('day 1: a and c came back, b did not, d is counted', at(1).cohort === 4 && at(1).returned === 2, JSON.stringify(at(1)));
  check('day 7 leaves out an account too new to have had the chance', at(7).cohort === 3 && at(7).returned === 2, JSON.stringify(at(7)));
  check('day 30 counts only accounts a month old', at(30).cohort === 3 && at(30).returned === 1, JSON.stringify(at(30)));
  check('the funnel counts accounts, not events', s.funnel.visit === 4 && s.funnel.enter === 1 && s.funnel.train === 1);
  check('days are UTC', dayKey(Date.UTC(2026, 9, 10, 23, 30)) === '2026-10-10');
}

// ---------------------------------------------------------------- calendar
function calendarTest(): void {
  console.log(CHAPTER + 'Race calendar');
  const round = 42;
  const ics = raceCalendarIcs(round, 'https://example.test', Date.UTC(2026, 9, 1));
  const start = new Date(startsAtForRound(round)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ics.split('\r\n');
  // Round 42 is Sunday 25.10.2026, the evening Israel goes back to winter time.
  check('the event starts at 20:00 Israel time on the round\'s day',
    ics.includes('\r\nDTSTART;TZID=Asia/Jerusalem:20261025T200000\r\n'), start);
  check('and carries the zone, so it stays at 20:00 through clock changes',
    ics.includes('\r\nBEGIN:VTIMEZONE\r\nTZID:Asia/Jerusalem\r\n'));
  const summer = raceCalendarIcs(30, 'https://example.test');
  check('a summer round is 20:00 too', summer.includes('DTSTART;TZID=Asia/Jerusalem:20261013T200000'));
  check('and repeats every day', ics.includes('\r\nRRULE:FREQ=DAILY\r\n'));
  check('with a reminder fifteen minutes before', ics.includes('\r\nTRIGGER:-PT15M\r\n'));
  check('every line ends in CRLF', !/[^\r]\n/.test(ics) && ics.endsWith('\r\n'));
  const enc = new TextEncoder();
  const longest = Math.max(...lines.map((l) => enc.encode(l).length));
  check('no content line is longer than 75 octets', longest <= 75, String(longest));
  const hebrew = 'SUMMARY:' + 'מרוץ '.repeat(30);
  const unfolded = foldLine(hebrew).replace(/\r\n /g, '');
  check('folding Hebrew loses nothing', unfolded === hebrew);
  const g = new URL(googleCalendarUrl(round, 'https://example.test'));
  check('the Google link carries the same start and the daily rule',
    g.searchParams.get('dates') === '20261025T200000/20261025T203000' &&
      g.searchParams.get('ctz') === 'Asia/Jerusalem' && g.searchParams.get('recur') === 'RRULE:FREQ=DAILY');
}

// ---------------------------------------------------------------- recap
function recapTest(): void {
  console.log(CHAPTER + 'What happened to my car');
  // Round 1: a wins. Round 2: a starts from pole but finishes third, b0 wins.
  const ids = ['a', 'b0', 'b1', 'b2'];
  const r1 = fakeCard(1, ids);
  const r2 = fakeCard(2, ids);
  const results = new Map<string, RaceResult>([
    [r1.id, fakeResult(r1.id, [fakePlace('a', 1), fakePlace('b0', 2), fakePlace('b1', 3), fakePlace('b2', 4)])],
    [r2.id, fakeResult(r2.id, [fakePlace('b0', 1), fakePlace('b1', 2), fakePlace('a', 3), fakePlace('b2', 4)])],
  ]);
  const res2 = results.get(r2.id)!;
  res2.sessions = [{
    sessionId: 'race', grid: ids, fastestLap: { entryId: 'a', ms: 41_200 },
    classification: [{
      entryId: 'a', position: 3, laps: RACE_LAPS, totalMs: 1, gapMs: 1, bestLapMs: 41_200, bestSectorsMs: [],
      lapTimesMs: [], lapPositions: [], topSpeed: 1, overtakes: 0, wallHits: 0, carHits: 0, lapsLed: 0,
      status: 'finished', gridPos: 1,
    }],
  }];
  res2.fastestLap = { entryId: 'a', ms: 41_200 };
  const [mine, ...more] = carRecaps(r2, [r1, r2], results, 'u');
  check('one line per car of the team, and only theirs', !!mine && more.length === 0 && mine.entryId === 'a');
  check('final place and the points it earned', mine.position === 3 && mine.points === POINTS[2]);
  check('two places lost from pole', mine.startPos === 1 && mine.gained === -2, String(mine.gained));
  check('its own quickest lap, marked as the fastest of the day', mine.bestLapMs === 41_200 && mine.fastestOfDay);
  // After round 1: a 25, b0 18. After round 2: b0 43, a 40 — a drops to second.
  check('the table move is worked out from before and after the round', mine.standingBefore === 1 && mine.standing === 2,
    `${mine.standingBefore} → ${mine.standing}`);
  check('a team with no car in the race gets no card', carRecaps(r2, [r1, r2], results, 'nobody').length === 0);
  check('nor does a race whose result is not out yet', carRecaps(r2, [r1, r2], new Map([[r1.id, results.get(r1.id)!]]), 'u').length === 0);
}

// ---------------------------------------------------------------- target
function targetTest(): void {
  console.log(CHAPTER + 'Training target');
  const ids = ['a', 'b0'];
  const pole = (c: RaceCard, ms: number, physics?: number): RaceCard => ({
    ...c,
    physics,
    qualifying: [{ entryId: 'b0', bestLapMs: ms, sectorsMs: [], topSpeed: 1 }, { entryId: 'a', bestLapMs: ms + 500, sectorsMs: [], topSpeed: 1 }],
  });
  const n = TRACK_DEFS.length;
  const track = trackForRound(1);
  // Rounds 1 and 1+n run the same circuit; 1+2n is in the future.
  const cards = [
    pole({ ...fakeCard(1, ids), trackId: track }, 42_000, 1),
    pole({ ...fakeCard(1 + n, ids), trackId: track }, 41_000, 2),
    pole({ ...fakeCard(1 + 2 * n, ids), trackId: track }, 30_000, 2),
    pole({ ...fakeCard(2, ids), trackId: trackForRound(2) }, 20_000, 2),
  ];
  const now = startsAtForRound(1 + n) + 1000;
  const t = trainingTarget(cards, new Map(), track, 2, now);
  check('the latest pole on this circuit, not a future one or another track', t?.kind === 'pole' && t.ms === 41_000, String(t?.ms));
  check('and who set it', t?.driver === 'b0' && t.round === 1 + n && t.samePhysics);
  const old = trainingTarget(cards, new Map(), track, 2, startsAtForRound(1) + 1000);
  check('a pole from the old physics is used, but flagged', old?.ms === 42_000 && old.samePhysics === false);
  check('no Grand Prix on this circuit, no target', trainingTarget(cards, new Map(), trackForRound(3), 2, now) === null);
}

// ---------------------------------------------------------------- sliders
function sliderTest(): void {
  console.log(CHAPTER + 'Sliders and styles');
  // Right always means "more of this": a bigger bonus, a harsher penalty, or —
  // for contact, the one channel that crosses zero — more willingness to touch.
  const backwards = RACING_SPEC.rewardChannels.filter((c) => {
    const penalty = c.levels.every((v) => v <= 0) && c.key !== 'carHit';
    const strength = c.levels.map((v) => (penalty ? -v : v));
    return strength.some((v, i) => i > 0 && v < strength[i - 1]);
  });
  check('every slider grows to the right', backwards.length === 0, backwards.map((c) => c.key).join(', ') || 'all ten');
  // The flip is display only: a fresh model starts on the same weights as before.
  const d = defaultRewards(RACING_SPEC);
  check('the default weights did not move',
    d.wallHit === -3 && d.reverse === -0.3 && d.idle === -0.15 && d.timeStep === -0.005 && d.carHit === -0.5,
    JSON.stringify({ wallHit: d.wallHit, reverse: d.reverse, idle: d.idle, timeStep: d.timeStep }));
  const wall = RACING_SPEC.rewardChannels.find((c) => c.key === 'wallHit')!;
  check('a saved weight still opens on the matching notch', levelOf(wall, -6) === 10 && levelOf(wall, 0) === 1);

  const balanced = RACING_PRESETS.find((p) => p.id === 'balanced')!;
  check('balanced is the defaults', matchingPreset(RACING_SPEC, d)?.id === 'balanced' &&
    JSON.stringify(presetRewards(RACING_SPEC, balanced)) === JSON.stringify(d));
  const careful = presetRewards(RACING_SPEC, RACING_PRESETS.find((p) => p.id === 'careful')!);
  const aggressive = presetRewards(RACING_SPEC, RACING_PRESETS.find((p) => p.id === 'aggressive')!);
  check('careful punishes the wall harder and pays less for speed', careful.wallHit < d.wallHit && careful.speed < d.speed);
  check('aggressive pays more for speed and overtakes', aggressive.speed > d.speed && aggressive.overtake > d.overtake);
  check('no style touches what teaches a car to follow the road',
    [careful, aggressive].every((t) => t.checkpoint === d.checkpoint && t.lap === d.lap && t.finish === d.finish));
  check('a table tuned by hand is no preset', matchingPreset(RACING_SPEC, { ...d, lap: 30 }) === null);
}

// ---------------------------------------------------------------- house
function houseTest(): void {
  console.log(CHAPTER + 'House drivers');
  const round = HOUSE_FROM_ROUND;
  const before = lockAtForRound(round) - 1000;
  const real = (id: string, uid: string) => ({ ...fakeCard(round, [id]).entries[0], id, uid, team: uid, createdAt: before });

  const solo = eligibleEntries([real('a', 'u1')], round);
  check('one real car is topped up so there is a race', solo.length >= MIN_ENTRIES && solo[0].id === 'a',
    solo.map((e) => e.id).join(','));
  check('with the weakest house car first', solo[1]?.id === HOUSE_DRIVERS[0].id);
  const two = eligibleEntries([real('a', 'u1'), real('b', 'u1')], round);
  check('a thin grid fills to six', two.length === HOUSE_GRID, String(two.length));
  const full = eligibleEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => real(id, `u-${id}`)), round);
  check('a full grid gets no house car', full.every((e) => e.uid !== HOUSE_UID));
  check('an empty grid stays empty', eligibleEntries([], round).length === 0);
  check('rounds before the house existed are left as they were',
    eligibleEntries([{ ...real('a', 'u1'), createdAt: 0 }], round - 1).length === 1);
  const impostor = eligibleEntries([real('a', 'u1'), { ...real('house-1', 'u2') }, { ...real('x', HOUSE_UID) }], round);
  check('an entry posing as the house is ignored',
    impostor.filter((e) => e.id === 'house-1').length === 1 && impostor.every((e) => e.id !== 'x' && (e.id !== 'house-1' || e.uid === HOUSE_UID)));

  // The house scores drivers' points but is no constructor.
  const card = { ...fakeCard(round, []), entries: two };
  // The house cars take the top four places.
  const houseWin = fakeResult(card.id, [...two].reverse().map((e, i) => fakePlace(e.id, i + 1)));
  const s = buildStandings({ cards: [card], results: new Map([[card.id, houseWin]]) });
  check('house cars are in the drivers\' table', s.drivers.some((d) => d.uid === HOUSE_UID && d.points > 0));
  check('but not in the teams\' table', s.teams.every((t) => t.uid !== HOUSE_UID && t.team !== HOUSE_TEAM), s.teams.map((t) => t.team).join(','));
  check('nobody can take the house team\'s name', teamNameProblem(HOUSE_TEAM) !== null && teamNameProblem(' קבוצת  הבית ') !== null);

  // The files exist, match the declared shape, and drive.
  for (const h of HOUSE_DRIVERS) {
    let ok = false;
    let detail = '';
    try {
      const file = JSON.parse(readFileSync(`public/house/${h.id}.json`, 'utf8')) as { weightsB64: string; arch: typeof h.arch };
      const shape = JSON.stringify(file.arch) === JSON.stringify(h.arch);
      const policy = Policy.fromBase64(h.arch.obsSize, h.arch.hidden, h.arch.nActions, file.weightsB64);
      const sim = new SessionSim(trackForRound(round), QUALI_LAPS, [{ entryId: h.id, policy }], 1, physicsForRound(round));
      sim.runToEnd();
      const lap = sim.env.telemetry(0).bestLapMs;
      ok = shape && lap !== null;
      detail = `${shape ? '' : 'arch mismatch '}lap ${lap === null ? '—' : (lap / 1000).toFixed(2)}`;
    } catch (e) {
      detail = String(e);
    }
    check(`${h.id} loads and sets a lap on the first house circuit`, ok, detail);
  }
}

// ---------------------------------------------------------------- seasons
function seasonTest(): void {
  console.log(CHAPTER + 'Seasons');
  // Season 1 is untouchable: its ids are its Firestore paths, its seeds its results.
  const oldSeed = (round: number) => {
    let h = 2166136261 ^ round;
    for (const ch of 'S1') h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return (h >>> 0) % 1_000_000_007;
  };
  let legacy = true;
  for (let r = 1; r <= 41; r++) {
    if (raceIdForRound(r) !== `S1-R${String(r).padStart(3, '0')}` || seedForRound(r) !== oldSeed(r)) legacy = false;
  }
  check('rounds 1–41 keep their season-1 ids and seeds', legacy);
  check('round 42 opens season 2', raceIdForRound(42) === 'S2-R042' && seasonForRound(42) === 'S2');
  check('eight rounds a season', seasonNumber(49) === 2 && seasonNumber(50) === 3 &&
    seasonRange(3).first === 50 && seasonRange(3).last === 57);
  check('every round belongs to exactly one season', [1, 2, 3, 4, 5].every((n) =>
    seasonRange(n + 1).first === seasonRange(n).last + 1));
  check('the final table stays up the day after a final',
    displaySeason(startsAtForRound(50) - BROADCAST_OPENS_MS - 1) === 2 && displaySeason(startsAtForRound(50) - BROADCAST_OPENS_MS) === 3);

  // Season 2 raced in full; a raced in season 1 too, and wins every S2 round.
  const ids = ['a', 'b0'];
  const cards = [40, ...Array.from({ length: 8 }, (_, i) => 42 + i), 50].map((r) => fakeCard(r, ids));
  const results = new Map<string, RaceResult>();
  for (const c of cards) {
    const order = c.round === 40 || c.round === 50 ? ['b0', 'a'] : ['a', 'b0'];
    results.set(c.id, fakeResult(c.id, order.map((id, i) => fakePlace(id, i + 1))));
  }
  const s3 = buildStandings({ cards: seasonCards(cards, 3), results });
  check('a new season starts from zero', s3.drivers.find((d) => d.entryId === 'a')?.points === POINTS[1] &&
    s3.drivers[0].entryId === 'b0');
  const fame = hallOfFame(cards, results, startsAtForRound(51));
  const s2 = fame.find((h) => h.season === 2);
  check('the season-2 champion is the one who won it', s2?.driver?.entryId === 'a' && s2.driver.points === 8 * POINTS[0] &&
    s2.races === 8, JSON.stringify(s2 && { d: s2.driver?.entryId, p: s2.driver?.points, r: s2.races }));
  check('and the teams\' title goes with it', s2?.team?.team === 'Alpha');
  check('an unfinished season crowns nobody', !fame.some((h) => h.season === 3));
  const pending = new Map(results);
  pending.delete(cards.find((c) => c.round === 49)!.id);
  check('nor does one whose final is not settled', !seasonComplete(2, cards, pending, startsAtForRound(49) + 1000));
  const noFinal = cards.filter((c) => c.round !== 49);
  check('a final that never ran ends the season a few hours on',
    !seasonComplete(2, noFinal, results, startsAtForRound(49) + 1000) &&
      seasonComplete(2, noFinal, results, startsAtForRound(49) + 4 * 3_600_000));
}

// ---------------------------------------------------------------- diagnosis
function diagnoseTest(): void {
  console.log(CHAPTER + 'Post-race diagnosis');
  const finish = (entryId: string, position: number, over: Partial<Finish> = {}): Finish => ({
    entryId, position, laps: RACE_LAPS, totalMs: 1, gapMs: 1, bestLapMs: 40_000, bestSectorsMs: [], lapTimesMs: [],
    lapPositions: [], topSpeed: 10, overtakes: 0, wallHits: 0, carHits: 0, lapsLed: 0, status: 'finished', gridPos: position,
    ...over,
  });
  const day = (cls: Finish[]) => {
    const card = fakeCard(42, cls.map((f) => f.entryId));
    const result = fakeResult(card.id, cls.map((f) => fakePlace(f.entryId, f.position)));
    result.sessions = [{ sessionId: 'race', grid: [], classification: cls, fastestLap: { entryId: cls[0].entryId, ms: 40_000 } }];
    return { card, result };
  };
  const kinds = (cls: Finish[], id: string) => { const d = day(cls); return diagnoseCar(d.card, d.result, id).map((a) => a.kind); };

  check('a car that covered under half the distance is not ready',
    kinds([finish('w', 1), finish('x', 2, { laps: 3, status: 'dnf' })], 'x').includes('unready'));
  const walls = day([finish('w', 1), finish('x', 2, { wallHits: 9 })]);
  const wallAdvice = diagnoseCar(walls.card, walls.result, 'x').find((a) => a.kind === 'walls');
  check('lots of wall contact points at the wall slider, to the right',
    wallAdvice?.slider === 'wallHit' && wallAdvice.direction === 'right');
  check('a low top speed points at the speed slider',
    kinds([finish('w', 1, { topSpeed: 12 }), finish('y', 2, { topSpeed: 12 }), finish('x', 3, { topSpeed: 9 })], 'x').includes('speed'));
  check('contact that cost places points at the contact slider, to the left',
    kinds([finish('w', 1), finish('x', 4, { carHits: 8, gridPos: 1 })], 'x').includes('contact'));
  check('contact while gaining places is left alone',
    !kinds([finish('w', 1), finish('x', 2, { carHits: 8, gridPos: 5 })], 'x').includes('contact'));
  check('a clean, slower car still gets advice', kinds([finish('w', 1), finish('x', 2, { bestLapMs: 42_000 })], 'x').join() === 'pace');
  check('a clean winner gets none', kinds([finish('w', 1), finish('x', 2)], 'w').length === 0);

  // A real day, with house cars: nobody who lost leaves without advice.
  const round = HOUSE_FROM_ROUND;
  const weights = new Map(HOUSE_DRIVERS.map((h) => [h.id, (JSON.parse(readFileSync(`public/house/${h.id}.json`, 'utf8')) as { weightsB64: string }).weightsB64]));
  const real = { ...HOUSE_DRIVERS[1], id: 'me', uid: 'u1', team: 'Real', driver: 'me', tag: 'ME', createdAt: 0 };
  weights.set('me', weights.get('house-2')!);
  const card = buildRaceCard(round, [real], weights);
  const result = runRaceDay(card, weights);
  const advice = diagnoseDay(card, result);
  const bare = result.places.filter((p) => p.position > 1 && (advice.get(p.entryId)?.length ?? 0) === 0);
  check('on a real race day every car that did not win gets advice', bare.length === 0,
    result.places.map((p) => `${p.position}.${p.entryId}:${(advice.get(p.entryId) ?? []).map((a) => a.kind).join('+') || '-'}`).join(' '));
}

console.log('RL core sanity checks');
gradientCheck();
xorTest();
serializeTest();
trackTest();
corridorTest();
gaTest();
sharedSessionTest();
flagTest();
timingTest();
physicsTest();
championshipTest();
nameGenTest();
teamLimitTest();
splitDriverTest();
competitorTest();
broadcastClockTest();
earlyFeedTest();
coachTest();
metricsTest();
calendarTest();
recapTest();
targetTest();
sliderTest();
houseTest();
seasonTest();
diagnoseTest();
console.log(failures === 0 ? '\nAll sanity checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
