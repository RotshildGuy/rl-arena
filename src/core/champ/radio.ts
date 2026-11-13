import type { RacingSnapshot } from '../games/racing/env';

/**
 * Team radio for the broadcast.
 *
 * Watches the snapshots of a race as it plays and, now and then, puts a radio
 * call on air between a driver and his team ("I touched the wall, is the wing
 * ok?"). It only reacts to what the race did - a pass that held, a hit that
 * cost speed, a finish - and the words are the dictionary's
 * (`broadcast.radio`), so this file has no language in it.
 *
 * Several cars often hit the same wall in one race. So the calls of one kind
 * never repeat a wording until every other wording of that kind has been
 * used: `seq` counts the calls of the kind and the screen takes
 * `(seed + seq) % wordings`. The seed comes from the race itself, so two
 * people watching the same replay read the same words.
 *
 * A seek is not a race event: when the playhead jumps (more than a couple of
 * seconds forward, or any distance back) everything is forgotten and watching
 * starts again from the new moment, quietly.
 *
 * (Season 4 also had a written commentary strip; it was taken out and only the
 * radio kept.)
 */

export type RadioKind =
  | 'passMade'
  | 'passLost'
  | 'wall'
  | 'contact'
  | 'slide'
  | 'fastLap'
  | 'lastLap'
  | 'battle'
  | 'win'
  | 'podium'
  | 'retired';

export interface Radio {
  at: number;
  car: number;
  kind: RadioKind;
  /** Which wording: `variant % wordings.length`. Consecutive calls of a kind never share one. */
  variant: number;
}

/** How long a radio call stays on screen. */
export const RADIO_MS = 5500;
/** Jumps bigger than this are a seek, not a race. */
const SEEK_MS = 2000;
/** A pass has to hold this long before it counts: side by side, the order flickers. */
const PASS_HOLD_MS = 700;
/** The same two cars swapping back within this is one fight, not a string of passes. */
const PAIR_COOLDOWN_MS = 6000;
/** Per car, between two mishaps. */
const MISHAP_COOLDOWN_MS = 6000;
/** Under this gap to the car ahead, two cars are fighting... */
const BATTLE_GAP_MS = 450;
/** ...for this long before the team says so... */
const BATTLE_HOLD_MS = 3000;
/** ...and not again for the same car for this long. */
const BATTLE_REPEAT_MS = 25000;
/** One call at a time, and not too often from one car. */
const RADIO_GAP_MS = 6500;
const RADIO_CAR_GAP_MS = 14000;

interface CarMemory {
  /** Recent speeds with their race times, oldest first, about half a second. */
  speeds: Array<[number, number]>;
  slideSince: number | null;
  mishapAt: number;
  radioAt: number;
  done: boolean;
  finished: boolean;
  battleSince: number | null;
  battleCalledAt: number;
}

interface PendingPass {
  car: number;
  other: number;
  since: number;
}

/** A small, stable hash: the same race always picks the same words. */
function hash(...xs: number[]): number {
  let h = 2166136261;
  for (const x of xs) {
    h ^= Math.floor(x) & 0xffffffff;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A number per kind name, to spread the seeds of the kinds apart. */
function kindCode(kind: RadioKind): number {
  let n = 0;
  for (let i = 0; i < kind.length; i++) n = n * 31 + kind.charCodeAt(i);
  return n;
}

export class TeamRadio {
  readonly radios: Radio[] = [];
  private cars: CarMemory[] = [];
  private lastMs: number | null = null;
  private lastOrder: number[] = [];
  private pending: PendingPass[] = [];
  private pairAt = new Map<string, number>();
  private fastest: number | null = null;
  private lastLapCalled = false;
  private lastRadioAt = -Infinity;
  /** Calls of each kind so far, and where that kind's wordings start. */
  private seq = new Map<RadioKind, number>();
  private seed = 0;

  /**
   * @param totalLaps the session's distance
   * @param favoured cars whose radio is preferred - the viewer's own
   */
  constructor(
    private readonly totalLaps: number,
    private readonly favoured: ReadonlySet<number> = new Set(),
  ) {}

  /** Feed every snapshot as it is shown. */
  observe(snap: RacingSnapshot): void {
    const now = snap.raceMs;
    if (this.lastMs === null || now < this.lastMs || now - this.lastMs > SEEK_MS) {
      this.resync(snap);
      return;
    }
    if (now === this.lastMs) return;

    this.watchCars(snap, now);
    this.watchOrder(snap, now);
    this.watchFastest(snap, now);
    this.watchLastLap(snap, now);
    this.watchBattles(snap, now);

    this.lastOrder = [...snap.order];
    this.lastMs = now;
  }

  /** The radio call on air at `now`, if any. */
  onAir(now: number): Radio | null {
    for (let i = this.radios.length - 1; i >= 0; i--) {
      const r = this.radios[i];
      if (r.at <= now && now - r.at < RADIO_MS) return r;
      if (now - r.at >= RADIO_MS) break;
    }
    return null;
  }

  // ------------------------------------------------------------ watching

  /** Forget everything and take this moment as the new starting point. */
  private resync(snap: RacingSnapshot): void {
    this.radios.length = 0;
    this.pending = [];
    this.pairAt.clear();
    this.seq.clear();
    // The grid as it stands decides where each kind's wordings start.
    this.seed = hash(snap.cars.length, ...snap.order);
    this.cars = snap.cars.map((c) => ({
      speeds: [[snap.raceMs, c.speed]],
      slideSince: null,
      mishapAt: -Infinity,
      radioAt: -Infinity,
      done: c.done,
      finished: c.finished,
      battleSince: null,
      battleCalledAt: -Infinity,
    }));
    this.fastest = snap.fastestLap?.ms ?? null;
    const leader = snap.cars[snap.order[0]];
    this.lastLapCalled = !!leader && leader.lap + 1 >= this.totalLaps;
    this.lastRadioAt = -Infinity;
    this.lastOrder = [...snap.order];
    this.lastMs = snap.raceMs;
  }

  private posOf(snap: RacingSnapshot, car: number): number {
    return snap.order.indexOf(car) + 1;
  }

  /** Mishaps, retirements and finishes: things that happen to one car. */
  private watchCars(snap: RacingSnapshot, now: number): void {
    snap.cars.forEach((c, i) => {
      const m = this.cars[i];
      if (!m) return;
      const pos = this.posOf(snap, i);

      if (c.finished && !m.finished) {
        m.finished = true;
        // The place is the one in the classification as the car crosses the
        // line, not the order home: cars a lap down are flagged off right
        // behind the winner, and a car still running further round is ahead
        // of them. It does not change afterwards.
        if (pos === 1) this.radio({ at: now, car: i, kind: 'win' }, true);
        else if (pos <= 3) this.radio({ at: now, car: i, kind: 'podium' });
      }
      if (c.done && !c.finished && !m.done) this.radio({ at: now, car: i, kind: 'retired' });
      m.done = c.done;
      if (c.done) return;

      // Speed half a second ago, against which a hit is measured.
      m.speeds.push([now, c.speed]);
      while (m.speeds.length > 1 && now - m.speeds[0][0] > 500) m.speeds.shift();
      const before = m.speeds[0][1];

      if (c.sliding) m.slideSince ??= now;
      else m.slideSince = null;

      if (now - m.mishapAt <= MISHAP_COOLDOWN_MS) return;
      let kind: RadioKind | null = null;
      if (c.touchingWall && before > 4 && c.speed < before * 0.75) kind = 'wall';
      else if (c.touchingCar && before > 3 && c.speed < before * 0.7) kind = 'contact';
      else if (m.slideSince !== null && now - m.slideSince >= 700) kind = 'slide';
      if (kind) {
        m.mishapAt = now;
        this.radio({ at: now, car: i, kind });
      }
    });
  }

  /**
   * Passes. A car that climbs past the one that was just ahead of it, and stays
   * there for a moment, has passed it. A car dropping because the one behind
   * retired or finished is not a pass.
   */
  private watchOrder(snap: RacingSnapshot, now: number): void {
    const prevPos = new Map(this.lastOrder.map((car, i) => [car, i]));
    snap.order.forEach((car, idx) => {
      const before = prevPos.get(car);
      if (before === undefined || idx >= before || snap.cars[car]?.done) return;
      const passed = this.lastOrder[idx];
      if (passed === undefined || passed === car) return;
      const p = snap.cars[passed];
      if (!p || p.done || p.finished || snap.cars[car]?.finished) return;
      this.pending = this.pending.filter((x) => !(x.car === passed && x.other === car));
      if (!this.pending.some((x) => x.car === car && x.other === passed)) {
        this.pending.push({ car, other: passed, since: now });
      }
    });

    const keep: PendingPass[] = [];
    for (const x of this.pending) {
      const still = snap.order.indexOf(x.car) < snap.order.indexOf(x.other);
      if (!still) continue;
      if (now - x.since < PASS_HOLD_MS) {
        keep.push(x);
        continue;
      }
      const key = x.car < x.other ? `${x.car}:${x.other}` : `${x.other}:${x.car}`;
      const last = this.pairAt.get(key) ?? -Infinity;
      this.pairAt.set(key, now);
      if (now - last < PAIR_COOLDOWN_MS) continue;
      // The call goes to whichever side of the pass is more worth hearing.
      const loser = this.favoured.has(x.other) && !this.favoured.has(x.car);
      if (loser) this.radio({ at: now, car: x.other, kind: 'passLost' });
      else if (!this.radio({ at: now, car: x.car, kind: 'passMade' })) this.radio({ at: now, car: x.other, kind: 'passLost' });
      const m = this.cars[x.car];
      if (m) m.battleSince = null;
    }
    this.pending = keep;
  }

  private watchFastest(snap: RacingSnapshot, now: number): void {
    const f = snap.fastestLap;
    if (!f || (this.fastest !== null && f.ms >= this.fastest)) return;
    const first = this.fastest === null;
    this.fastest = f.ms;
    // The first lap anyone completes is the fastest by default; that says nothing.
    if (!first) this.radio({ at: now, car: f.car, kind: 'fastLap' });
  }

  private watchLastLap(snap: RacingSnapshot, now: number): void {
    if (this.lastLapCalled || this.totalLaps < 2) return;
    const leaderIdx = snap.order.find((i) => !snap.cars[i]?.done);
    if (leaderIdx === undefined) return;
    if (snap.cars[leaderIdx].lap + 1 < this.totalLaps) return;
    this.lastLapCalled = true;
    this.radio({ at: now, car: leaderIdx, kind: 'lastLap' }, true);
  }

  private watchBattles(snap: RacingSnapshot, now: number): void {
    for (let p = 1; p < snap.order.length; p++) {
      const car = snap.order[p];
      const c = snap.cars[car];
      const m = this.cars[car];
      if (!c || !m || c.done || snap.cars[snap.order[p - 1]]?.done) continue;
      if (c.intervalMs > BATTLE_GAP_MS) {
        m.battleSince = null;
        continue;
      }
      m.battleSince ??= now;
      if (now - m.battleSince < BATTLE_HOLD_MS || now - m.battleCalledAt < BATTLE_REPEAT_MS) continue;
      m.battleCalledAt = now;
      this.radio({ at: now, car, kind: 'battle' });
    }
  }

  // ------------------------------------------------------------ output

  /**
   * A radio call, if the air is free. `force` is for the moments that matter
   * more than the spacing: the last lap and the win. Returns whether it went out.
   */
  private radio(r: Omit<Radio, 'variant'>, force = false): boolean {
    const m = this.cars[r.car];
    if (!m) return false;
    if (!force) {
      if (r.at - this.lastRadioAt < RADIO_GAP_MS) return false;
      // Somebody else's car only every so often; the viewer's own whenever it has something.
      const gap = this.favoured.has(r.car) ? RADIO_CAR_GAP_MS / 2 : RADIO_CAR_GAP_MS;
      if (r.at - m.radioAt < gap) return false;
    }
    const n = this.seq.get(r.kind) ?? 0;
    this.seq.set(r.kind, n + 1);
    // Small enough that adding the count never wraps past the safe integers.
    const start = hash(this.seed, kindCode(r.kind)) % 1_000_003;
    this.radios.push({ ...r, variant: start + n });
    this.lastRadioAt = r.at;
    m.radioAt = r.at;
    return true;
  }
}
