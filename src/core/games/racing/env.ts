import { mulberry32, type Rng } from '../../rng';
import type { Env, RewardConfig, StepResult } from '../types';
import { getTrack, segmentsIntersect, type Track } from './tracks';
import { OBS_SIZE, RACING_SPEC, SENSOR_COUNT, SENSOR_MAX, SENSOR_SPREAD } from './rewards';

export const CAR_RADIUS = 11;
const MAX_SPEED = 7;
const ACCEL = 0.22;
const BRAKE = 0.35;
const DRAG = 0.99;
const STEER_RATE = 0.06;
/** Fraction of sideways velocity killed per step — lower means more drift. */
const GRIP = 0.82;

export interface RacingConfig {
  trackId: string;
  nCars: number;
  laps: number;
  /** When false, cars pass straight through each other ("ghost" mode). */
  carCollisions: boolean;
  maxSteps: number;
  /** Episode ends for a car that goes this many steps without a checkpoint. */
  stuckLimit: number;
  /**
   * One agent exempt from the stuck limit, by index.
   *
   * A human should never be retired for sitting still — they may be reading the
   * standings — but the cars they are racing against must be, or one model that
   * beaches itself keeps the race open until the step cap with nothing left to
   * watch.
   */
  neverStuck?: number;
}

export const DEFAULT_RACING_CONFIG: RacingConfig = {
  trackId: 'oval',
  nCars: 4,
  laps: 3,
  carCollisions: true,
  maxSteps: 3000,
  stuckLimit: 180,
};

export interface CarSnapshot {
  x: number;
  y: number;
  angle: number;
  speed: number;
  lap: number;
  nextCp: number;
  progress: number;
  done: boolean;
  finished: boolean;
  touchingWall: boolean;
  touchingCar: boolean;
  reverse: boolean;
  /** Continuous distance covered, in laps. Monotone, so it survives the start line. */
  trackPos: number;
  /** Which third of the lap the car is in, 0-2. */
  sector: number;
  /** Elapsed time of the lap in progress. */
  currentLapMs: number;
  lastLapMs: number | null;
  bestLapMs: number | null;
  /** Sector times of the most recently completed lap. */
  lastSectorsMs: (number | null)[];
  /** Time from lights out to the flag, once finished. */
  totalMs: number | null;
  /** Seconds behind the leader, estimated from track position and speed. */
  gapMs: number;
  /** The same, to the car directly ahead. */
  intervalMs: number;
}

export interface RacingSnapshot {
  trackId: string;
  step: number;
  laps: number;
  cars: CarSnapshot[];
  /** Ray lengths of the focus car, for the sensor overlay. */
  focus: number;
  sensors: number[];
  /** Car indices ordered from first to last. */
  order: number[];
  /** Elapsed race time in ms — the clock a broadcast shows. */
  raceMs: number;
  /** Fastest lap of the race so far: car index and time. */
  fastestLap: { car: number; ms: number } | null;
}

/** One simulation step of wall-clock time. The whole game runs at a fixed 60 Hz. */
export const STEP_MS = 1000 / 60;

/** Room under one lap of the classification key for a finishing step number. */
const TIME_SCALE = 1e6;

/** Per-car counters a race report is built from. Cheap to keep, impossible to reconstruct. */
export interface CarTelemetry {
  lapTimesMs: number[];
  sectorTimesMs: number[][];
  bestLapMs: number | null;
  bestSectorsMs: (number | null)[];
  totalMs: number | null;
  topSpeed: number;
  wallHits: number;
  carHits: number;
  overtakes: number;
  lapsLed: number;
  laps: number;
  finished: boolean;
  /** Retired: ran out of road or out of time without finishing. */
  dnf: boolean;
}

export class RacingEnv implements Env<RacingSnapshot> {
  readonly spec = RACING_SPEC;
  readonly nAgents: number;
  rewards: RewardConfig;
  config: RacingConfig;

  /** Per-seat reward tables, when several models share the grid. */
  private agentRewards: Array<RewardConfig | null>;

  /**
   * True once somebody has taken the chequered flag.
   *
   * From then on the flag is out for everybody: the next car to cross the line
   * is classified there and then, on whatever lap it happens to be, exactly as a
   * real race ends. Without this a race lasts as long as its slowest survivor,
   * and a session spends most of its broadcast watching one car trundle round
   * alone.
   */
  private flagOut = false;

  private track: Track;
  private rng: Rng;

  // Per-car state, flat for cheap iteration.
  private px: Float32Array;
  private py: Float32Array;
  private prevX: Float32Array;
  private prevY: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private angle: Float32Array;
  private nextCp: Int32Array;
  private laps: Int32Array;
  private progress: Int32Array;
  private ci: Int32Array;
  private stepsSinceCp: Int32Array;
  private doneFlag: Uint8Array;
  private finished: Uint8Array;
  private touchingWall: Uint8Array;
  private touchingCar: Uint8Array;
  private prevTouchingWall: Uint8Array;
  private prevTouchingCar: Uint8Array;
  private reverseFlag: Uint8Array;
  private rank: Int32Array;

  // --- timing ---
  /** Continuous progress in centreline-index units. Monotone, unlike `ci`, which wraps. */
  private arc: Float64Array;
  private lapStartStep: Int32Array;
  private sectorStartStep: Int32Array;
  private sectorIdx: Int32Array;
  private finishStep: Int32Array;
  private lapTimes: number[][];
  private sectorTimes: number[][][];
  private bestLapSteps: Float64Array;
  private bestSectorSteps: Float64Array;
  private lastLapSteps: Float64Array;
  private lastSectors: Float64Array;
  private topSpeed: Float32Array;
  private wallHitCount: Int32Array;
  private carHitCount: Int32Array;
  private overtakeCount: Int32Array;
  private lapsLed: Int32Array;
  /** Set once a lap number has been completed by someone — that car led it. */
  private lapClaimed: Uint8Array;
  private gapSteps: Float64Array;
  private intervalSteps: Float64Array;
  /** How many times each car has crossed the timing line. */
  private lineCross: Int32Array;
  /** Sector times of the lap currently in progress. */
  private pendingSectors: Float64Array;
  private fastestCar = -1;
  private fastestSteps = Infinity;
  /** Centreline index where each sector begins. Sectors split the lap into thirds. */
  private sectorStarts: number[];

  private sensors: Float32Array;
  private rewardBuf: Float32Array;
  private doneBuf: Uint8Array;
  private normal = new Float32Array(2);
  private orderScratch: Int32Array;
  private keyScratch: Float64Array;

  step_ = 0;
  focus = 0;

  constructor(config: RacingConfig, rewards: RewardConfig) {
    this.config = { ...config };
    this.rewards = { ...rewards };
    this.agentRewards = new Array(config.nCars).fill(null);
    this.nAgents = config.nCars;
    this.track = getTrack(config.trackId);
    this.rng = mulberry32(1);

    const n = this.nAgents;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.prevX = new Float32Array(n);
    this.prevY = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.angle = new Float32Array(n);
    this.nextCp = new Int32Array(n);
    this.laps = new Int32Array(n);
    this.progress = new Int32Array(n);
    this.ci = new Int32Array(n);
    this.stepsSinceCp = new Int32Array(n);
    this.doneFlag = new Uint8Array(n);
    this.finished = new Uint8Array(n);
    this.touchingWall = new Uint8Array(n);
    this.touchingCar = new Uint8Array(n);
    this.prevTouchingWall = new Uint8Array(n);
    this.prevTouchingCar = new Uint8Array(n);
    this.reverseFlag = new Uint8Array(n);
    this.rank = new Int32Array(n);
    this.sensors = new Float32Array(n * SENSOR_COUNT);
    this.rewardBuf = new Float32Array(n);
    this.doneBuf = new Uint8Array(n);
    this.orderScratch = new Int32Array(n);
    this.keyScratch = new Float64Array(n);

    this.arc = new Float64Array(n);
    this.lapStartStep = new Int32Array(n);
    this.sectorStartStep = new Int32Array(n);
    this.sectorIdx = new Int32Array(n);
    this.finishStep = new Int32Array(n);
    this.lapTimes = [];
    this.sectorTimes = [];
    this.bestLapSteps = new Float64Array(n);
    this.bestSectorSteps = new Float64Array(n * 3);
    this.lastLapSteps = new Float64Array(n);
    this.lastSectors = new Float64Array(n * 3);
    this.topSpeed = new Float32Array(n);
    this.wallHitCount = new Int32Array(n);
    this.carHitCount = new Int32Array(n);
    this.overtakeCount = new Int32Array(n);
    this.lapsLed = new Int32Array(n);
    this.lapClaimed = new Uint8Array(config.laps + 2);
    this.gapSteps = new Float64Array(n);
    this.intervalSteps = new Float64Array(n);
    this.lineCross = new Int32Array(n);
    this.pendingSectors = new Float64Array(n * 3);

    const nCp = this.track.nCheckpoints;
    this.sectorStarts = [0, Math.floor(nCp / 3), Math.floor((2 * nCp) / 3)];
  }

  get trackRef(): Track {
    return this.track;
  }

  setAgentRewards(agent: number, rewards: RewardConfig): void {
    if (agent < 0 || agent >= this.nAgents) return;
    this.agentRewards[agent] = { ...rewards };
  }

  reset(seed: number): void {
    this.rng = mulberry32(seed);
    this.step_ = 0;
    this.flagOut = false;
    const t = this.track;
    const n = this.nAgents;
    const cpStride = t.cpIndex.length > 1 ? t.cpIndex[1] - t.cpIndex[0] : 8;

    for (let i = 0; i < n; i++) {
      const lane = i % 3;
      const row = Math.floor(i / 3);
      // Line the grid up behind the start gate.
      const idx = (t.def.samples - (row + 1) * cpStride * 0.75 + t.def.samples) % t.def.samples | 0;
      const cx = t.center[idx * 2];
      const cy = t.center[idx * 2 + 1];
      const tx = t.tangent[idx * 2];
      const ty = t.tangent[idx * 2 + 1];
      // Jitter the grid slot a little: identical starts every episode let the
      // model memorise one racing line instead of learning to drive. The lateral
      // spacing leaves roughly a car's width between neighbours, because a grid
      // that starts cars already touching turns every race into a first-corner
      // pile-up rather than a race.
      const offset = (lane - 1) * t.def.width * 0.33 + (this.rng() - 0.5) * 7;
      this.px[i] = cx - ty * offset;
      this.py[i] = cy + tx * offset;
      this.prevX[i] = this.px[i];
      this.prevY[i] = this.py[i];
      this.vx[i] = 0;
      this.vy[i] = 0;
      this.angle[i] = Math.atan2(ty, tx) + (this.rng() - 0.5) * 0.2;
      this.nextCp[i] = 0;
      this.laps[i] = 0;
      this.progress[i] = 0;
      this.ci[i] = idx;
      this.stepsSinceCp[i] = 0;
      this.doneFlag[i] = 0;
      this.finished[i] = 0;
      this.touchingWall[i] = 0;
      this.touchingCar[i] = 0;
      this.reverseFlag[i] = 0;
      this.rank[i] = i;

      // Negative: the grid sits behind the timing line, and the rank order at
      // lights out has to reflect that or every car starts "equal first".
      this.arc[i] = idx - t.def.samples;
      this.lapStartStep[i] = 0;
      this.sectorStartStep[i] = 0;
      this.sectorIdx[i] = 0;
      this.finishStep[i] = -1;
      this.bestLapSteps[i] = Infinity;
      this.lastLapSteps[i] = 0;
      this.topSpeed[i] = 0;
      this.wallHitCount[i] = 0;
      this.carHitCount[i] = 0;
      this.overtakeCount[i] = 0;
      this.lapsLed[i] = 0;
      this.gapSteps[i] = 0;
      this.intervalSteps[i] = 0;
      this.lineCross[i] = 0;
      for (let s = 0; s < 3; s++) {
        this.bestSectorSteps[i * 3 + s] = Infinity;
        this.lastSectors[i * 3 + s] = 0;
        this.pendingSectors[i * 3 + s] = 0;
      }
    }
    this.lapTimes = Array.from({ length: n }, () => []);
    this.sectorTimes = Array.from({ length: n }, () => []);
    this.lapClaimed.fill(0);
    this.fastestCar = -1;
    this.fastestSteps = Infinity;
    this.updateRanks();
    this.castAllSensors();
  }

  private castAllSensors(): void {
    const t = this.track;
    const dA = SENSOR_SPREAD / (SENSOR_COUNT - 1);
    for (let i = 0; i < this.nAgents; i++) {
      const base = i * SENSOR_COUNT;
      const a0 = this.angle[i] - SENSOR_SPREAD / 2;
      for (let k = 0; k < SENSOR_COUNT; k++) {
        const a = a0 + k * dA;
        this.sensors[base + k] = t.grid.raycast(this.px[i], this.py[i], Math.cos(a), Math.sin(a), SENSOR_MAX);
      }
    }
  }

  /** Track the closest centreline index incrementally — cars never jump far in one step. */
  private updateCentrelineIndex(i: number): void {
    const t = this.track;
    const n = t.def.samples;
    let best = this.ci[i];
    let bestD = Infinity;
    for (let d = -12; d <= 12; d++) {
      const j = (((this.ci[i] + d) % n) + n) % n;
      const dx = t.center[j * 2] - this.px[i];
      const dy = t.center[j * 2 + 1] - this.py[i];
      const dist = dx * dx + dy * dy;
      if (dist < bestD) {
        bestD = dist;
        best = j;
      }
    }
    // Accumulate the *signed* step so `arc` keeps counting past the start line.
    // The raw index wraps to zero there, which would make every gap calculation
    // jump by a full lap exactly when the timing screen matters most.
    let delta = best - this.ci[i];
    if (delta > n / 2) delta -= n;
    else if (delta < -n / 2) delta += n;
    this.arc[i] += delta;
    this.ci[i] = best;
  }

  /**
   * Timing for one gate crossing. Returns true when a full lap was completed.
   *
   * The clock starts at the *line*, not on the grid: cars are gridded a little
   * way behind it, so timing from step zero would hand the front row a lap time
   * the back row can never match. Total race time still runs from lights out, so
   * grid position keeps mattering exactly where it should.
   */
  private recordGate(i: number, cp: number): boolean {
    const s3 = i * 3;
    if (cp !== 0) {
      // Mid-lap sector boundary.
      const sec = this.sectorStarts.indexOf(cp) - 1;
      if (sec >= 0 && this.lineCross[i] > 0) {
        const t = this.step_ - this.sectorStartStep[i];
        this.pendingSectors[s3 + sec] = t;
        if (t < this.bestSectorSteps[s3 + sec]) this.bestSectorSteps[s3 + sec] = t;
        this.sectorStartStep[i] = this.step_;
        this.sectorIdx[i] = sec + 1;
      }
      return false;
    }

    // The timing line.
    const first = this.lineCross[i] === 0;
    this.lineCross[i]++;
    if (first) {
      this.lapStartStep[i] = this.step_;
      this.sectorStartStep[i] = this.step_;
      this.sectorIdx[i] = 0;
      return false;
    }

    const t3 = this.step_ - this.sectorStartStep[i];
    this.pendingSectors[s3 + 2] = t3;
    if (t3 < this.bestSectorSteps[s3 + 2]) this.bestSectorSteps[s3 + 2] = t3;

    const lapSteps = this.step_ - this.lapStartStep[i];
    this.laps[i]++;
    this.lapTimes[i].push(lapSteps);
    this.sectorTimes[i].push([this.pendingSectors[s3], this.pendingSectors[s3 + 1], this.pendingSectors[s3 + 2]]);
    this.lastLapSteps[i] = lapSteps;
    for (let s = 0; s < 3; s++) this.lastSectors[s3 + s] = this.pendingSectors[s3 + s];
    if (lapSteps < this.bestLapSteps[i]) this.bestLapSteps[i] = lapSteps;
    if (lapSteps < this.fastestSteps) {
      this.fastestSteps = lapSteps;
      this.fastestCar = i;
    }
    // Whoever completes a given lap number first was leading it.
    const l = this.laps[i];
    if (l < this.lapClaimed.length && !this.lapClaimed[l]) {
      this.lapClaimed[l] = 1;
      this.lapsLed[i]++;
    }

    this.lapStartStep[i] = this.step_;
    this.sectorStartStep[i] = this.step_;
    this.sectorIdx[i] = 0;
    return true;
  }

  /**
   * Gaps in time, from gaps in distance. A timing screen that only showed track
   * position would be unreadable — "0.4s behind" is the number a viewer can use.
   */
  private updateGaps(): void {
    const n = this.nAgents;
    const unitsPerIndex = this.track.length / this.track.def.samples;
    const order = this.orderScratch;
    for (let i = 0; i < n; i++) order[this.rank[i]] = i;

    for (let r = 0; r < n; r++) {
      const car = order[r];
      if (r === 0) {
        this.gapSteps[car] = 0;
        this.intervalSteps[car] = 0;
        continue;
      }
      const leader = order[0];
      const ahead = order[r - 1];
      // Closing speed of the chasing car: a stopped car would otherwise report an
      // infinite gap, which is true but useless.
      const v = Math.max(1.2, Math.hypot(this.vx[car], this.vy[car]));
      this.gapSteps[car] = ((this.arc[leader] - this.arc[car]) * unitsPerIndex) / v;
      this.intervalSteps[car] = ((this.arc[ahead] - this.arc[car]) * unitsPerIndex) / v;
    }
  }

  /** Everything a race report needs that the snapshot does not carry. */
  telemetry(i: number): CarTelemetry {
    const s3 = i * 3;
    return {
      lapTimesMs: this.lapTimes[i].map((s) => s * STEP_MS),
      sectorTimesMs: this.sectorTimes[i].map((row) => row.map((s) => s * STEP_MS)),
      bestLapMs: isFinite(this.bestLapSteps[i]) ? this.bestLapSteps[i] * STEP_MS : null,
      bestSectorsMs: [0, 1, 2].map((s) =>
        isFinite(this.bestSectorSteps[s3 + s]) ? this.bestSectorSteps[s3 + s] * STEP_MS : null,
      ),
      totalMs: this.finishStep[i] >= 0 ? this.finishStep[i] * STEP_MS : null,
      topSpeed: this.topSpeed[i],
      wallHits: this.wallHitCount[i],
      carHits: this.carHitCount[i],
      overtakes: this.overtakeCount[i],
      lapsLed: this.lapsLed[i],
      laps: this.laps[i],
      finished: this.finished[i] === 1,
      dnf: this.doneFlag[i] === 1 && this.finished[i] === 0,
    };
  }

  /** Continuous progress in laps — the quantity the classification is sorted by. */
  trackPos(i: number): number {
    return this.arc[i] / this.track.def.samples;
  }

  /**
   * Cheap timing read for the training loop, which wants these every episode and
   * must not allocate the full telemetry object to get them.
   */
  raceStats(i: number): { bestLapMs: number | null; totalMs: number | null } {
    return {
      bestLapMs: isFinite(this.bestLapSteps[i]) ? this.bestLapSteps[i] * STEP_MS : null,
      totalMs: this.finishStep[i] >= 0 ? this.finishStep[i] * STEP_MS : null,
    };
  }

  /** Live classification position of a car, 0 for the leader. */
  rankOf(i: number): number {
    return this.rank[i];
  }

  /**
   * Classification key, high to low.
   *
   * Distance first, time second. A car that took the flag is placed on the line
   * it crossed rather than on how far past it the car coasted — otherwise the
   * order would be decided by whoever overshot furthest on the final step — and
   * among cars flagged on the same lap, the one that got there first. A car
   * still running is ranked on the distance it has covered, which is what puts
   * it ahead of a car that has already been flagged a lap down.
   */
  private sortKey(i: number): number {
    const samples = this.track.def.samples;
    if (!this.finished[i]) return this.arc[i] * TIME_SCALE;
    return this.laps[i] * samples * TIME_SCALE + (TIME_SCALE - 1 - this.finishStep[i]);
  }

  private updateRanks(): void {
    const order = this.orderScratch;
    for (let i = 0; i < this.nAgents; i++) {
      order[i] = i;
      this.keyScratch[i] = this.sortKey(i);
    }
    // Insertion sort: nAgents is tiny and this runs every step.
    for (let a = 1; a < order.length; a++) {
      const v = order[a];
      const kv = this.keyScratch[v];
      let b = a - 1;
      while (b >= 0 && this.keyScratch[order[b]] < kv) {
        order[b + 1] = order[b];
        b--;
      }
      order[b + 1] = v;
    }
    for (let r = 0; r < order.length; r++) this.rank[order[r]] = r;
  }

  step(actions: Int32Array): StepResult {
    const t = this.track;
    const n = this.nAgents;
    this.rewardBuf.fill(0);
    this.step_++;

    const prevRank = this.orderScratch.slice();
    for (let i = 0; i < n; i++) prevRank[i] = this.rank[i];

    // --- integrate ---
    for (let i = 0; i < n; i++) {
      this.prevTouchingWall[i] = this.touchingWall[i];
      this.prevTouchingCar[i] = this.touchingCar[i];
      this.touchingWall[i] = 0;
      this.touchingCar[i] = 0;
      if (this.doneFlag[i]) continue;

      const a = actions[i];
      const throttle = (a / 3) | 0; // 0 gas, 1 coast, 2 brake
      const steer = (a % 3) - 1; // -1 left, 0 straight, +1 right

      let cos = Math.cos(this.angle[i]);
      let sin = Math.sin(this.angle[i]);
      let fwd = this.vx[i] * cos + this.vy[i] * sin;
      let lat = -this.vx[i] * sin + this.vy[i] * cos;

      // Steering authority grows with speed — a parked car cannot turn.
      const authority = Math.min(1, Math.abs(fwd) / 1.8);
      this.angle[i] += steer * STEER_RATE * authority * Math.sign(fwd || 1);
      cos = Math.cos(this.angle[i]);
      sin = Math.sin(this.angle[i]);

      if (throttle === 0) fwd += ACCEL;
      else if (throttle === 2) fwd -= BRAKE;

      fwd *= DRAG;
      lat *= 1 - GRIP;
      fwd = Math.max(-MAX_SPEED * 0.3, Math.min(MAX_SPEED, fwd));

      this.vx[i] = fwd * cos - lat * sin;
      this.vy[i] = fwd * sin + lat * cos;

      this.prevX[i] = this.px[i];
      this.prevY[i] = this.py[i];
      this.px[i] += this.vx[i];
      this.py[i] += this.vy[i];
    }

    // --- walls ---
    for (let i = 0; i < n; i++) {
      if (this.doneFlag[i]) continue;
      const depth = t.grid.circleOverlap(this.px[i], this.py[i], CAR_RADIUS, this.normal);
      if (depth <= 0) continue;
      const nx = this.normal[0];
      const ny = this.normal[1];
      this.px[i] += nx * depth;
      this.py[i] += ny * depth;
      const vn = this.vx[i] * nx + this.vy[i] * ny;
      if (vn < 0) {
        this.vx[i] -= vn * nx * 1.2;
        this.vy[i] -= vn * ny * 1.2;
      }
      this.vx[i] *= 0.55;
      this.vy[i] *= 0.55;
      this.touchingWall[i] = 1;
    }

    // --- car vs car ---
    if (this.config.carCollisions) {
      const minDist = CAR_RADIUS * 2;
      for (let i = 0; i < n; i++) {
        if (this.doneFlag[i]) continue;
        for (let j = i + 1; j < n; j++) {
          if (this.doneFlag[j]) continue;
          const dx = this.px[j] - this.px[i];
          const dy = this.py[j] - this.py[i];
          const d2 = dx * dx + dy * dy;
          if (d2 >= minDist * minDist || d2 === 0) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const ny = dy / d;
          const push = (minDist - d) / 2;
          this.px[i] -= nx * push;
          this.py[i] -= ny * push;
          this.px[j] += nx * push;
          this.py[j] += ny * push;
          // Exchange the velocity component along the contact normal.
          const vi = this.vx[i] * nx + this.vy[i] * ny;
          const vj = this.vx[j] * nx + this.vy[j] * ny;
          if (vi - vj > 0) {
            const transfer = (vi - vj) * 0.7;
            this.vx[i] -= transfer * nx;
            this.vy[i] -= transfer * ny;
            this.vx[j] += transfer * nx;
            this.vy[j] += transfer * ny;
          }
          this.touchingCar[i] = 1;
          this.touchingCar[j] = 1;
        }
      }
    }

    // --- progress, rewards, termination ---
    const nCp = t.nCheckpoints;
    // Raised, not read, inside the loop: the flag has to fall for everyone on
    // the same step regardless of car order, so it takes effect from the next.
    let flagFalls = false;
    for (let i = 0; i < n; i++) {
      if (this.doneFlag[i]) {
        this.doneBuf[i] = 1;
        continue;
      }

      this.updateCentrelineIndex(i);
      const ti = this.ci[i];
      const tx = t.tangent[ti * 2];
      const ty = t.tangent[ti * 2 + 1];
      const alongTrack = this.vx[i] * tx + this.vy[i] * ty;
      this.reverseFlag[i] = alongTrack < -0.2 ? 1 : 0;

      // Gate crossing, but only when travelling the right way round.
      const cp = this.nextCp[i];
      const g = cp * 4;
      let passed = false;
      let lapDone = false;
      if (
        alongTrack > 0 &&
        segmentsIntersect(
          this.prevX[i], this.prevY[i], this.px[i], this.py[i],
          t.checkpoints[g], t.checkpoints[g + 1], t.checkpoints[g + 2], t.checkpoints[g + 3],
        )
      ) {
        passed = true;
        this.progress[i]++;
        this.stepsSinceCp[i] = 0;
        this.nextCp[i] = (cp + 1) % nCp;
        lapDone = this.recordGate(i, cp);
      } else {
        this.stepsSinceCp[i]++;
      }

      // Whoever drives this car scores it: with several models on the grid each
      // seat carries its own table, and falls back to the shared one otherwise.
      const w = this.agentRewards[i] ?? this.rewards;
      const cosA = Math.cos(this.angle[i]);
      const sinA = Math.sin(this.angle[i]);
      const fwd = this.vx[i] * cosA + this.vy[i] * sinA;
      const speed = Math.hypot(this.vx[i], this.vy[i]);

      let r = w.timeStep ?? 0;
      if (fwd > 0) r += (w.speed ?? 0) * (fwd / MAX_SPEED);
      if (passed) {
        r += w.checkpoint ?? 0;
        if (lapDone) r += w.lap ?? 0;
      }
      // Charged on impact, not per step of contact. Penalising every frame of a
      // scrape makes standing still cheaper than driving, and the agent learns to
      // park on the grid instead of racing.
      if (this.touchingWall[i] && !this.prevTouchingWall[i]) {
        r += w.wallHit ?? 0;
        this.wallHitCount[i]++;
      }
      if (this.touchingCar[i] && !this.prevTouchingCar[i]) {
        r += w.carHit ?? 0;
        this.carHitCount[i]++;
      }
      if (this.reverseFlag[i]) r += w.reverse ?? 0;
      if (speed < 0.4) r += w.idle ?? 0;
      if (speed > this.topSpeed[i]) this.topSpeed[i] = speed;

      const wentTheDistance = this.laps[i] >= this.config.laps;
      // Flagged off: the leader is home, and this car has just reached the line.
      // It is classified on the laps it actually completed.
      if (wentTheDistance || (this.flagOut && lapDone)) {
        this.finished[i] = 1;
        this.doneFlag[i] = 1;
        this.finishStep[i] = this.step_;
        // Only the full distance earns the finish bonus, or a model would learn
        // that being lapped by a faster one pays the same as racing it.
        if (wentTheDistance) {
          r += w.finish ?? 0;
          flagFalls = true;
        }
      } else if (this.stepsSinceCp[i] > this.config.stuckLimit && i !== this.config.neverStuck) {
        this.doneFlag[i] = 1;
      }

      this.rewardBuf[i] = r;
      this.doneBuf[i] = this.doneFlag[i];
    }

    if (flagFalls) this.flagOut = true;

    // Overtaking is scored after every car has moved, so ranks are consistent.
    this.updateRanks();
    for (let i = 0; i < n; i++) {
      const gained = prevRank[i] - this.rank[i];
      if (gained > 0 && !this.doneBuf[i]) {
        this.overtakeCount[i] += gained;
        const overtakeW = (this.agentRewards[i] ?? this.rewards).overtake ?? 0;
        if (overtakeW !== 0) this.rewardBuf[i] += overtakeW * gained;
      }
    }
    this.updateGaps();

    this.castAllSensors();

    let allDone = this.step_ >= this.config.maxSteps;
    if (!allDone) {
      allDone = true;
      for (let i = 0; i < n; i++) {
        if (!this.doneFlag[i]) {
          allDone = false;
          break;
        }
      }
    }

    return { rewards: this.rewardBuf, done: this.doneBuf, allDone };
  }

  observe(i: number, out: Float32Array): Float32Array {
    const t = this.track;
    const base = i * SENSOR_COUNT;
    for (let k = 0; k < SENSOR_COUNT; k++) out[k] = this.sensors[base + k] / SENSOR_MAX;

    const cosA = Math.cos(this.angle[i]);
    const sinA = Math.sin(this.angle[i]);
    out[9] = (this.vx[i] * cosA + this.vy[i] * sinA) / MAX_SPEED;
    out[10] = (-this.vx[i] * sinA + this.vy[i] * cosA) / MAX_SPEED;

    // Next gate, and the one after it for lookahead, in the car's own frame.
    const nCp = t.nCheckpoints;
    for (let k = 0; k < 2; k++) {
      const cp = (this.nextCp[i] + k) % nCp;
      const dx = t.cpMid[cp * 2] - this.px[i];
      const dy = t.cpMid[cp * 2 + 1] - this.py[i];
      const rx = dx * cosA + dy * sinA;
      const ry = -dx * sinA + dy * cosA;
      const d = Math.hypot(rx, ry) || 1;
      if (k === 0) {
        out[11] = ry / d;
        out[12] = rx / d;
        out[13] = Math.min(1, d / 300);
      } else {
        out[14] = ry / d;
        out[15] = rx / d;
      }
    }

    // The two nearest opponents. Padded with zeros so obsSize never changes.
    let n1 = -1;
    let n2 = -1;
    let d1 = Infinity;
    let d2 = Infinity;
    for (let j = 0; j < this.nAgents; j++) {
      if (j === i || this.doneFlag[j]) continue;
      const dx = this.px[j] - this.px[i];
      const dy = this.py[j] - this.py[i];
      const dd = dx * dx + dy * dy;
      if (dd < d1) {
        d2 = d1;
        n2 = n1;
        d1 = dd;
        n1 = j;
      } else if (dd < d2) {
        d2 = dd;
        n2 = j;
      }
    }
    for (let k = 0; k < 2; k++) {
      const j = k === 0 ? n1 : n2;
      const o = 16 + k * 4;
      if (j < 0) {
        out[o] = 0;
        out[o + 1] = 0;
        out[o + 2] = 0;
        out[o + 3] = 0;
        continue;
      }
      const dx = this.px[j] - this.px[i];
      const dy = this.py[j] - this.py[i];
      const rx = dx * cosA + dy * sinA;
      const ry = -dx * sinA + dy * cosA;
      const dvx = this.vx[j] - this.vx[i];
      const dvy = this.vy[j] - this.vy[i];
      out[o] = Math.max(-1, Math.min(1, rx / 200));
      out[o + 1] = Math.max(-1, Math.min(1, ry / 200));
      out[o + 2] = (dvx * cosA + dvy * sinA) / MAX_SPEED;
      out[o + 3] = (-dvx * sinA + dvy * cosA) / MAX_SPEED;
    }
    return out;
  }

  isAgentDone(i: number): boolean {
    return this.doneFlag[i] === 1;
  }

  score(i: number): number {
    return this.laps[i];
  }

  snapshot(): RacingSnapshot {
    const cars: CarSnapshot[] = [];
    for (let i = 0; i < this.nAgents; i++) {
      const s3 = i * 3;
      cars.push({
        x: this.px[i],
        y: this.py[i],
        angle: this.angle[i],
        speed: Math.hypot(this.vx[i], this.vy[i]),
        lap: this.laps[i],
        nextCp: this.nextCp[i],
        progress: this.progress[i],
        done: this.doneFlag[i] === 1,
        finished: this.finished[i] === 1,
        touchingWall: this.touchingWall[i] === 1,
        touchingCar: this.touchingCar[i] === 1,
        reverse: this.reverseFlag[i] === 1,
        trackPos: this.arc[i] / this.track.def.samples,
        sector: this.sectorIdx[i],
        currentLapMs: this.lineCross[i] > 0 ? (this.step_ - this.lapStartStep[i]) * STEP_MS : 0,
        lastLapMs: this.lastLapSteps[i] > 0 ? this.lastLapSteps[i] * STEP_MS : null,
        bestLapMs: isFinite(this.bestLapSteps[i]) ? this.bestLapSteps[i] * STEP_MS : null,
        lastSectorsMs: [0, 1, 2].map((s) => (this.lastSectors[s3 + s] > 0 ? this.lastSectors[s3 + s] * STEP_MS : null)),
        totalMs: this.finishStep[i] >= 0 ? this.finishStep[i] * STEP_MS : null,
        gapMs: this.gapSteps[i] * STEP_MS,
        intervalMs: this.intervalSteps[i] * STEP_MS,
      });
    }
    const order: number[] = [];
    for (let i = 0; i < this.nAgents; i++) order.push(i);
    order.sort((a, b) => this.rank[a] - this.rank[b]);

    const f = Math.min(this.focus, this.nAgents - 1);
    const sensors: number[] = [];
    for (let k = 0; k < SENSOR_COUNT; k++) sensors.push(this.sensors[f * SENSOR_COUNT + k]);

    return {
      trackId: this.track.def.id,
      step: this.step_,
      laps: this.config.laps,
      cars,
      focus: f,
      sensors,
      order,
      raceMs: this.step_ * STEP_MS,
      fastestLap: this.fastestCar >= 0 ? { car: this.fastestCar, ms: this.fastestSteps * STEP_MS } : null,
    };
  }
}

export function makeObsBuffer(): Float32Array {
  return new Float32Array(OBS_SIZE);
}
