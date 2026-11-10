import type { RacingSnapshot } from '../../core/games/racing/env';

/**
 * The director: which car the broadcast shows, and from where.
 *
 * Pure logic on snapshots, with no three.js in it, so it can be tested. It
 * reads only the race clock, never the wall clock.
 *
 * Written to a spec drawn from how real world feeds are cut (F1's, and
 * sim-racing directors'), scaled to laps of eight to ten seconds:
 *
 * - Shots last 5-14 s (about one cut a lap); a trackside take is one pass of
 *   3.5-4.5 s; the helicopter may hold 18 s; the overview 4-6 s.
 * - A cut that is due waits up to 2 s for the car to be on a straight or out
 *   of a corner. Only an incident cuts mid-corner, and only after 2.5 s.
 * - A new story has to last before it is cut to: a battle starts under 700 ms
 *   held for a second and ends over 1100 ms held for two; an incident is a real
 *   loss of speed or a real slide, not a scrape.
 * - No jump cuts: never the same shot on the same car twice running.
 * - The 180-degree rule: the side-on shots of one story stay on one side.
 */

/** Where the camera is. `overview` is the whole circuit; `finish` is fixed on the line; the rest follow a car. */
export type Shot = 'overview' | 'chase' | 'trackside' | 'low' | 'heli' | 'finish';

/** Why the director is on a car: the panel says so, the way a caption would. */
export type Reason = 'start' | 'leader' | 'finish' | 'incident' | 'battle' | 'fastest' | 'field' | 'overview';

export interface CameraSpec {
  shot: Shot;
  /** Grid slot of the car the shot is on. Ignored by `overview`. */
  car: number;
  /** A second car to keep in frame - the other half of a battle. */
  rival?: number | null;
  /** Which side of the road the side-on shots stand on: +1 or -1, fixed for a story. */
  side?: number;
  /** For a trackside take: how far ahead of the car, in seconds, the camera stands. */
  lead?: number;
  /** True on the frame of a cut, so the camera jumps instead of gliding across the circuit. */
  cut: boolean;
}

export interface DirectorState extends CameraSpec {
  reason: Reason;
  rival: number | null;
  /** Race time of the last cut, for the panel's caption to fade by. */
  cutAt: number;
}

export const MIN_HOLD_MS = 5000;
export const MAX_HOLD_MS = 14000;
const HELI_MAX_MS = 18000;
const TRACKSIDE_MIN_MS = 3400;
/** A trackside camera stands this far down the road: the car passes it, and the take ends a second later. */
const TRACKSIDE_LEAD_S = 2.4;
const TRACKSIDE_MAX_MS = 4500;
const OVERVIEW_MS = 4500;
/** How long a due cut may wait for the car to come out of a corner. */
const CUT_GRACE_MS = 2000;
/** A corner, for the purpose of not cutting in one: turning faster than this, rad/s. */
const CORNER_YAW = 0.6;
/** An incident may cut into a shot this old. */
export const INCIDENT_AFTER_MS = 2500;
/** Battle hysteresis. */
export const BATTLE_START_MS = 700;
const BATTLE_END_MS = 1100;
export const BATTLE_CONFIRM_MS = 1000;
const BATTLE_LOST_MS = 2000;
/** A battle is followed at most this long, then the director moves on. */
const BATTLE_STORY_MS = 18000;
/** The quiet leader, then a look down the field. */
const LEADER_QUIET_MS = 15000;
const FIELD_STORY_MS = 12000;
/** The overview, when nothing is happening, about every three laps. */
const OVERVIEW_EVERY_MS = 30000;
/** The start sequence: overview, the front two from above, then the pack. */
export const START_OVERVIEW_MS = 3000;
const START_HELI_MS = 8000;
export const START_END_MS = 14000;

/** The shots each story is told with, in turn. */
const SHOTS: Record<Reason, Shot[]> = {
  start: ['overview'],
  leader: ['chase', 'heli', 'trackside', 'low'],
  finish: ['chase', 'heli'],
  incident: ['heli', 'trackside'],
  battle: ['chase', 'heli', 'trackside', 'low'],
  fastest: ['chase'],
  field: ['chase', 'trackside', 'heli', 'low'],
  overview: ['overview'],
};

interface Story {
  reason: Reason;
  car: number;
  rival: number | null;
}

/** What the director remembers about one car between frames. */
interface Watch {
  angle: number;
  /** Turn rate, rad/s, smoothed. */
  yaw: number;
  /** Recent speeds with their race times, for "lost speed in the last half second". */
  speeds: Array<[number, number]>;
  slideSince: number | null;
}

export class Director {
  private state: DirectorState | null = null;
  /** The planned length of the shot on screen. */
  private planned = MIN_HOLD_MS;
  private storyStart = 0;
  private lastMs = -1;
  private cuts = 0;
  private lastOverview = 0;
  private cars: Watch[] = [];
  /**
   * Battles, by the chasing car: since when the gap has been under the start
   * line without a break, since when it has been over the end line, and the
   * battles that are on (closed for long enough, and not yet opened up again).
   */
  private closing = new Map<number, number>();
  private opened = new Map<number, number>();
  private battles = new Set<number>();
  private passAt: number | null = null;
  private fieldTurn = 0;
  /** When each car took the flag. */
  private finishedAt = new Map<number, number>();
  /** The two cars of a battle just shown, left alone for a while so it is not told twice. */
  private cooldown: { cars: number[]; until: number } | null = null;
  private snap: RacingSnapshot | null = null;

  constructor(private readonly totalLaps: number) {}

  /** Start again, as after a seek backwards through a replay. */
  reset(): void {
    this.state = null;
    this.planned = MIN_HOLD_MS;
    this.storyStart = 0;
    this.lastMs = -1;
    this.cuts = 0;
    this.lastOverview = 0;
    this.cars = [];
    this.closing.clear();
    this.opened.clear();
    this.battles.clear();
    this.passAt = null;
    this.fieldTurn = 0;
    this.finishedAt.clear();
    this.cooldown = null;
  }

  update(snap: RacingSnapshot): DirectorState {
    const now = snap.raceMs;
    if (now < this.lastMs) this.reset();
    const dt = this.lastMs < 0 ? 0 : (now - this.lastMs) / 1000;
    this.lastMs = now;
    this.snap = snap;
    this.observe(snap, now, dt);

    const cur = this.state;
    const start = this.startStory(snap, now);
    if (!cur) return this.cutTo(start ?? this.leaderStory(snap), now, start ? this.startShot(now) : undefined);

    // The start runs its own sequence and nothing pre-empts it.
    if (start) {
      // Cut only when the sequence moves on; the car in a shot stays its car
      // even if the order shuffles under it.
      const shot = this.startShot(now);
      if (shot !== cur.shot) return this.cutTo(start, now, shot);
      return this.hold(cur, snap);
    }

    const held = now - cur.cutAt;
    // Out of the race: retired, or two seconds past the flag (the crossing is the shot).
    const subject = snap.cars[cur.car];
    const subjectOut =
      cur.shot !== 'overview' &&
      (!subject || (subject.done && (!subject.finished || now - (this.finishedAt.get(cur.car) ?? now) > 2000)));
    const incident = this.incident(snap, now);
    const best = this.story(snap, now);

    // An incident cuts in early, and wherever the car is.
    if (incident && incident.car !== cur.car && cur.reason !== 'incident' && held >= INCIDENT_AFTER_MS) {
      return this.cutTo(incident, now);
    }
    if (subjectOut) return this.cutTo(best, now);

    const maxHold = cur.shot === 'heli' ? HELI_MAX_MS : cur.shot === 'trackside' ? TRACKSIDE_MAX_MS : MAX_HOLD_MS;
    const minHold = cur.shot === 'trackside' ? TRACKSIDE_MIN_MS : cur.shot === 'overview' ? OVERVIEW_MS - 500 : MIN_HOLD_MS;
    if (held < minHold) return this.hold(cur, snap);

    // A stronger story may cut in once the minimum is up; otherwise wait for the planned length.
    const stronger = rank(best.reason) > rank(cur.reason) && best.car !== cur.car;
    if (!stronger && held < this.planned) return this.hold(cur, snap);
    // Not in the middle of a corner, unless the shot has run out of road.
    const cornering = (this.cars[cur.car]?.yaw ?? 0) > CORNER_YAW;
    if (cornering && held < Math.min(maxHold, this.planned + CUT_GRACE_MS)) return this.hold(cur, snap);

    // The same story goes on with a fresh angle; a new one starts its own sequence.
    return this.cutTo(best, now);
  }

  // ------------------------------------------------------------ watching

  private observe(snap: RacingSnapshot, now: number, dt: number): void {
    snap.cars.forEach((c, i) => {
      const t = (this.cars[i] ??= { angle: c.angle, yaw: 0, speeds: [], slideSince: null });
      if (dt > 0) {
        const raw = Math.abs(Math.atan2(Math.sin(c.angle - t.angle), Math.cos(c.angle - t.angle))) / dt;
        t.yaw += (Math.min(raw, 20) - t.yaw) * Math.min(1, dt * 8);
      }
      t.angle = c.angle;
      t.speeds.push([now, c.speed]);
      while (t.speeds.length > 2 && t.speeds[0][0] < now - 600) t.speeds.shift();
      t.slideSince = c.sliding && Math.abs(c.slip) > 1.2 ? (t.slideSince ?? now) : null;
      if (c.finished && !this.finishedAt.has(i)) this.finishedAt.set(i, now);
    });

    // Battles, with hysteresis: keyed by the chasing car.
    for (let p = 1; p < snap.order.length; p++) {
      const i = snap.order[p];
      const c = snap.cars[i];
      const ahead = snap.cars[snap.order[p - 1]];
      const live = !!c && !!ahead && !c.done && !ahead.done;
      const close = live && c.intervalMs > 0 && c.intervalMs < BATTLE_START_MS;
      if (close) {
        if (!this.closing.has(i)) this.closing.set(i, now);
        if (now - this.closing.get(i)! >= BATTLE_CONFIRM_MS) this.battles.add(i);
      } else {
        this.closing.delete(i);
      }
      if (!live || c.intervalMs > BATTLE_END_MS) {
        if (!this.opened.has(i)) this.opened.set(i, now);
        if (!live || now - this.opened.get(i)! > BATTLE_LOST_MS) this.battles.delete(i);
      } else {
        this.opened.delete(i);
      }
    }
    // A car that has dropped out of the order is in no battle.
    for (const i of this.battles) if (!snap.order.includes(i) || snap.order.indexOf(i) === 0) this.battles.delete(i);
    // A pass in the battle on screen: two more seconds, then it is over.
    const cur = this.state;
    if (cur?.reason === 'battle' && cur.rival !== null && this.passAt === null) {
      if (snap.order.indexOf(cur.car) < snap.order.indexOf(cur.rival)) this.passAt = now;
    }
  }

  /** A battle that has lasted, highest up the order first. */
  private battle(snap: RacingSnapshot): Story | null {
    for (let p = 1; p < snap.order.length; p++) {
      const i = snap.order[p];
      const rival = snap.order[p - 1];
      const cooling = this.cooldown && this.lastMs < this.cooldown.until && (this.cooldown.cars.includes(i) || this.cooldown.cars.includes(rival));
      if (this.battles.has(i) && !cooling) return { reason: 'battle', car: i, rival };
    }
    return null;
  }

  /** A real incident near the front: lost speed in contact, a hard hit on the wall, a long slide. */
  private incident(snap: RacingSnapshot, now: number): Story | null {
    for (const i of snap.order.slice(0, 5)) {
      const c = snap.cars[i];
      const t = this.cars[i];
      if (!c || !t || c.done) continue;
      const before = t.speeds[0]?.[1] ?? c.speed;
      const lost = before > 1 && c.speed < before * 0.75;
      // A scrape is not a story; a hit that costs a fifth of the speed is.
      const hit = c.touchingWall && before > 4 && c.speed < before * 0.8;
      const slid = t.slideSince !== null && now - t.slideSince >= 400;
      if ((c.touchingCar && lost) || hit || slid) return { reason: 'incident', car: i, rival: null };
    }
    return null;
  }

  // ------------------------------------------------------------ stories

  private leader(snap: RacingSnapshot): number {
    return snap.order.find((i) => !snap.cars[i]?.done) ?? snap.order[0] ?? 0;
  }

  private leaderStory(snap: RacingSnapshot): Story {
    return { reason: 'leader', car: this.leader(snap), rival: null };
  }

  private startStory(snap: RacingSnapshot, now: number): Story | null {
    if (now >= START_END_MS) return null;
    const [p1 = 0, p2 = null, p3 = null] = snap.order;
    if (now < START_HELI_MS) return { reason: 'start', car: p1, rival: now < START_OVERVIEW_MS ? null : p2 };
    return { reason: 'start', car: p3 ?? p1, rival: null };
  }

  private startShot(now: number): Shot {
    return now < START_OVERVIEW_MS ? 'overview' : now < START_HELI_MS ? 'heli' : 'chase';
  }

  /** The best story right now, incidents aside. */
  private story(snap: RacingSnapshot, now: number): Story {
    const cur = this.state!;
    const leader = this.leader(snap);
    const order = snap.order;
    const lead = snap.cars[leader];

    // After the flag: the line, car after car, then the whole circuit.
    if (snap.cars[order[0]]?.finished) {
      const running = order.find((i) => !snap.cars[i]?.done);
      if (running === undefined) return { reason: 'overview', car: order[0], rival: null };
      return { reason: 'finish', car: running, rival: null };
    }
    // The last lap: the leader, with second place in frame if it is close.
    if (lead && lead.lap >= this.totalLaps - 1) {
      const p2 = order[order.indexOf(leader) + 1];
      const close = p2 !== undefined && (snap.cars[p2]?.intervalMs ?? Infinity) < 1000;
      return { reason: 'finish', car: close ? p2 : leader, rival: close ? leader : null };
    }

    const battle = this.battle(snap);
    // The battle on screen goes on until it is decided or has had its time.
    if (cur.reason === 'battle' && cur.rival !== null) {
      const over =
        (this.passAt !== null && now - this.passAt > 2000) ||
        !this.battles.has(cur.car) ||
        now - this.storyStart > BATTLE_STORY_MS;
      // The pair stays the pair, even after one passes the other.
      if (!over) return { reason: 'battle', car: cur.car, rival: cur.rival };
      this.cooldown = { cars: [cur.car, cur.rival], until: now + 10000 };
      const next = this.battle(snap);
      if (next) return next;
      return this.quiet(snap, now, cur);
    }
    if (battle) return battle;
    return this.quiet(snap, now, cur);
  }

  /** Nothing going on: the leader, now and then the field, now and then the whole circuit. */
  private quiet(snap: RacingSnapshot, now: number, cur: DirectorState): Story {
    const leader = this.leader(snap);
    if (now - this.lastOverview > OVERVIEW_EVERY_MS && cur.shot !== 'overview') {
      return { reason: 'overview', car: leader, rival: null };
    }
    if (cur.reason === 'field' && now - this.storyStart < FIELD_STORY_MS && !snap.cars[cur.car]?.done) {
      return { reason: 'field', car: cur.car, rival: null };
    }
    if (cur.reason === 'leader' && now - this.storyStart > LEADER_QUIET_MS) {
      const running = snap.order.filter((i) => i !== leader && !snap.cars[i]?.done);
      if (running.length) return { reason: 'field', car: running[this.fieldTurn++ % running.length], rival: null };
    }
    return { reason: 'leader', car: leader, rival: null };
  }

  // ------------------------------------------------------------ cutting

  private hold(cur: DirectorState, _snap: RacingSnapshot): DirectorState {
    cur.cut = false;
    return cur;
  }

  /** Roughly how long until a car crosses the line, from how far round the lap it is. */
  private toLine(car: number): number {
    const c = this.snap?.cars[car];
    if (!c) return Infinity;
    const frac = c.trackPos - Math.floor(c.trackPos);
    return (1 - frac) * (c.lastLapMs ?? 9000);
  }

  /** Two cars close enough that the same shot of each would look like the same picture. */
  private near(a: number, b: number): boolean {
    const ca = this.snap?.cars[a];
    const cb = this.snap?.cars[b];
    return !!ca && !!cb && Math.hypot(ca.x - cb.x, ca.y - cb.y) < 300;
  }

  private cutTo(story: Story, now: number, forced?: Shot): DirectorState {
    const prev = this.state;
    const sameStory = !!prev && prev.reason === story.reason && prev.car === story.car;
    if (!sameStory) {
      this.storyStart = now;
      this.passAt = null;
    }
    const shots = SHOTS[story.reason];
    let shot = forced ?? shots[this.cuts % shots.length];
    if (!forced) {
      // No jump cuts: never the same shot on the same car, or on a car close to it, twice running.
      if (prev && prev.shot === shot && (prev.car === story.car || this.near(prev.car, story.car))) {
        shot = shots[(this.cuts + 1) % shots.length];
        if (shot === prev.shot) shot = shot === 'chase' ? 'heli' : 'chase';
      }
      // The finish line, only when the car is about to cross it.
      if (story.reason === 'finish' && this.toLine(story.car) <= 2500) shot = 'finish';
      // The low camera only on a straight: it cannot keep a car in frame through a corner.
      if (shot === 'low' && (this.cars[story.car]?.yaw ?? 0) > 0.3) shot = prev?.shot === 'heli' && prev.car === story.car ? 'chase' : 'heli';
    }
    this.cuts++;
    if (shot === 'overview') this.lastOverview = now;
    // A planned length that varies, so the rhythm does not tick like a metronome.
    this.planned =
      shot === 'finish' ? Math.min(MAX_HOLD_MS, this.toLine(story.car) + 1500)
      : story.reason === 'incident' ? 5000
      : shot === 'trackside' ? TRACKSIDE_MIN_MS + 100
      : shot === 'overview' ? OVERVIEW_MS
      : shot === 'heli' ? 9000 + ((this.cuts * 1931) % 4000)
      : 6000 + ((this.cuts * 1373) % 3000);
    // One side of the road for the whole story (the 180-degree rule).
    const side = prev?.side && prev.car === story.car ? prev.side : story.car % 2 ? 1 : -1;
    const lead = story.reason === 'incident' ? 0.5 : TRACKSIDE_LEAD_S;
    this.state = { shot, car: story.car, rival: story.rival, reason: story.reason, side, lead, cut: true, cutAt: now };
    return this.state;
  }
}

/** How strong a story is: a stronger one may cut in once the shot on screen has run its minimum. */
function rank(r: Reason): number {
  return { overview: 0, field: 0, leader: 1, fastest: 2, battle: 3, incident: 4, finish: 5, start: 6 }[r];
}

/** The car directly ahead in the running order, if there is one. */
export function carAhead(snap: RacingSnapshot, car: number): number | null {
  const p = snap.order.indexOf(car);
  return p > 0 ? snap.order[p - 1] : null;
}

/** The car directly behind in the running order, if there is one. */
export function carBehind(snap: RacingSnapshot, car: number): number | null {
  const p = snap.order.indexOf(car);
  return p >= 0 && p + 1 < snap.order.length ? snap.order[p + 1] : null;
}
