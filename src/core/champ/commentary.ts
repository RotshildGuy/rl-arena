import type { RacingSnapshot } from '../games/racing/env';

/**
 * Written commentary and team radio for the broadcast.
 *
 * Watches the snapshots of a race as it plays and turns what happens into
 * events: a commentary line for the whole audience ("X takes the lead") and,
 * now and then, a radio call between a driver and his team ("I touched the
 * wall, is the wing ok?"). It only says what the race did - nothing is made
 * up - and the words themselves are the dictionary's (`broadcast.commentary`
 * and `broadcast.radio`), so this file has no language in it.
 *
 * The race is deterministic and the choice of words is seeded from the event,
 * so two people watching the same replay read the same lines.
 *
 * A seek is not a race event: when the playhead jumps (more than a couple of
 * seconds forward, or any distance back) everything is forgotten and watching
 * starts again from the new moment, quietly.
 */

export type CommentKind =
  | 'start'
  | 'lead'
  | 'pass'
  | 'fastLap'
  | 'lastLap'
  | 'wall'
  | 'contact'
  | 'slide'
  | 'battle'
  | 'retired'
  | 'win'
  | 'podium';

export interface Comment {
  /** Race time it happened at. */
  at: number;
  kind: CommentKind;
  car: number;
  /** The other car: the one passed, the one fought with. */
  other?: number;
  /** The place gained or held. */
  pos?: number;
  /** A lap time, or a gap in ms. */
  ms?: number;
  /** Which of the dictionary's wordings, so a replay reads the same. */
  variant: number;
}

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
  variant: number;
}

/** How long a radio call stays on screen. */
export const RADIO_MS = 5500;
/** Jumps bigger than this are a seek, not a race. */
const SEEK_MS = 2000;
/** A pass has to hold this long before it is called: side by side, the order flickers. */
const PASS_HOLD_MS = 700;
/** The same two cars swapping back within this is one fight, not a string of passes. */
const PAIR_COOLDOWN_MS = 6000;
/** Per car, between two mishaps called. */
const MISHAP_COOLDOWN_MS = 6000;
/** Under this gap to the car ahead, two cars are fighting. */
const BATTLE_GAP_MS = 450;
/** For this long, before the commentator says so. */
const BATTLE_HOLD_MS = 3000;
/** And not again about the same pair for this long. */
const BATTLE_REPEAT_MS = 25000;
/** Small things (a scrape, a slide, a fight) only for the cars up front... */
const MINOR_TOP = 6;
/** ...and not straight on top of another line. */
const MINOR_GAP_MS = 1800;
/** Radio: one call at a time, and not too often from one car. */
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
  pos: number;
}

/** A small, stable hash: the same event always picks the same words. */
function variantOf(...xs: number[]): number {
  let h = 2166136261;
  for (const x of xs) {
    h ^= Math.floor(x) & 0xffffffff;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Commentator {
  readonly comments: Comment[] = [];
  readonly radios: Radio[] = [];
  private cars: CarMemory[] = [];
  private lastMs: number | null = null;
  private lastOrder: number[] = [];
  private pending: PendingPass[] = [];
  private pairAt = new Map<string, number>();
  private fastest: number | null = null;
  private lastLapCalled = false;
  private started = false;
  private lastLineAt = -Infinity;
  private lastRadioAt = -Infinity;

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

    if (!this.started && now > 0) {
      this.started = true;
      if (now < 3000 && snap.order.length) this.say({ at: now, kind: 'start', car: snap.order[0] });
    }

    this.watchCars(snap, now);
    this.watchOrder(snap, now);
    this.watchFastest(snap, now);
    this.watchLastLap(snap, now);
    this.watchBattles(snap, now);

    this.lastOrder = [...snap.order];
    this.lastMs = now;
  }

  /** The lines to show at `now`, newest last. */
  recent(now: number, count: number, withinMs = 15000): Comment[] {
    const out: Comment[] = [];
    for (let i = this.comments.length - 1; i >= 0 && out.length < count; i--) {
      const c = this.comments[i];
      if (c.at > now) continue;
      if (now - c.at > withinMs) break;
      out.unshift(c);
    }
    return out;
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
    this.comments.length = 0;
    this.radios.length = 0;
    this.pending = [];
    this.pairAt.clear();
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
    this.started = snap.raceMs > 0;
    this.lastLineAt = -Infinity;
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
        if (pos === 1) {
          this.say({ at: now, kind: 'win', car: i, ms: c.totalMs ?? undefined });
          this.radio({ at: now, car: i, kind: 'win' }, true);
        } else if (pos <= 3) {
          this.say({ at: now, kind: 'podium', car: i, pos });
          this.radio({ at: now, car: i, kind: 'podium' });
        }
      }
      if (c.done && !c.finished && !m.done) {
        this.say({ at: now, kind: 'retired', car: i, pos });
        this.radio({ at: now, car: i, kind: 'retired' });
      }
      m.done = c.done;
      if (c.done) return;

      // Speed half a second ago, against which a hit is measured.
      m.speeds.push([now, c.speed]);
      while (m.speeds.length > 1 && now - m.speeds[0][0] > 500) m.speeds.shift();
      const before = m.speeds[0][1];
      const calm = now - m.mishapAt > MISHAP_COOLDOWN_MS;
      const minorOk = pos <= MINOR_TOP;

      if (c.sliding) m.slideSince ??= now;
      else m.slideSince = null;

      if (!calm) return;
      if (c.touchingWall && before > 4 && c.speed < before * 0.75) {
        m.mishapAt = now;
        if (minorOk) this.say({ at: now, kind: 'wall', car: i, pos }, true);
        this.radio({ at: now, car: i, kind: 'wall' });
      } else if (c.touchingCar && before > 3 && c.speed < before * 0.7) {
        m.mishapAt = now;
        if (minorOk) this.say({ at: now, kind: 'contact', car: i, pos }, true);
        this.radio({ at: now, car: i, kind: 'contact' });
      } else if (m.slideSince !== null && now - m.slideSince >= 700) {
        m.mishapAt = now;
        if (minorOk) this.say({ at: now, kind: 'slide', car: i, pos }, true);
        this.radio({ at: now, car: i, kind: 'slide' });
      }
    });
  }

  /**
   * Passes. A car that climbs past the one that was just ahead of it, and stays
   * there for a moment, has passed it. A car dropping because the one behind
   * retired or finished is not a pass and is never called.
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
        this.pending.push({ car, other: passed, since: now, pos: idx + 1 });
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
      const pos = snap.order.indexOf(x.car) + 1;
      this.say({ at: now, kind: pos === 1 ? 'lead' : 'pass', car: x.car, other: x.other, pos }, pos > MINOR_TOP);
      // The radio goes to whichever side of the pass is more worth hearing.
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
    if (first) return;
    this.say({ at: now, kind: 'fastLap', car: f.car, ms: f.ms });
    this.radio({ at: now, car: f.car, kind: 'fastLap' });
  }

  private watchLastLap(snap: RacingSnapshot, now: number): void {
    if (this.lastLapCalled || this.totalLaps < 2) return;
    const leaderIdx = snap.order.find((i) => !snap.cars[i]?.done);
    if (leaderIdx === undefined) return;
    const leader = snap.cars[leaderIdx];
    if (leader.lap + 1 < this.totalLaps) return;
    this.lastLapCalled = true;
    const second = snap.order[snap.order.indexOf(leaderIdx) + 1];
    const gap = second !== undefined ? snap.cars[second]?.gapMs : undefined;
    this.say({ at: now, kind: 'lastLap', car: leaderIdx, other: second, ms: gap });
    this.radio({ at: now, car: leaderIdx, kind: 'lastLap' }, true);
  }

  private watchBattles(snap: RacingSnapshot, now: number): void {
    for (let p = 1; p < snap.order.length; p++) {
      const car = snap.order[p];
      const ahead = snap.order[p - 1];
      const c = snap.cars[car];
      const m = this.cars[car];
      if (!c || !m || c.done || snap.cars[ahead]?.done) continue;
      if (c.intervalMs > BATTLE_GAP_MS) {
        m.battleSince = null;
        continue;
      }
      m.battleSince ??= now;
      if (now - m.battleSince < BATTLE_HOLD_MS || now - m.battleCalledAt < BATTLE_REPEAT_MS) continue;
      m.battleCalledAt = now;
      if (p + 1 <= MINOR_TOP) this.say({ at: now, kind: 'battle', car, other: ahead, pos: p + 1, ms: c.intervalMs }, true);
      this.radio({ at: now, car, kind: 'battle' });
    }
  }

  // ------------------------------------------------------------ output

  /** A commentary line. A minor one waits its turn: it is dropped if a line was just said. */
  private say(c: Omit<Comment, 'variant'>, minor = false): void {
    if (minor && c.at - this.lastLineAt < MINOR_GAP_MS) return;
    this.comments.push({ ...c, variant: variantOf(c.at, c.car, c.other ?? -1, c.kind.length) });
    this.lastLineAt = c.at;
  }

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
    this.radios.push({ ...r, variant: variantOf(r.at, r.car, r.kind.length, 7) });
    this.lastRadioAt = r.at;
    m.radioAt = r.at;
    return true;
  }
}
