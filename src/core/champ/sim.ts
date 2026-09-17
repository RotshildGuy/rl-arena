import { RacingEnv, STEP_MS, type RacingSnapshot } from '../games/racing/env';
import { OBS_SIZE, RACING_SPEC } from '../games/racing/rewards';
import { defaultRewards } from '../games/types';
import { Policy } from '../rl/policy';
import { lapsFor, planSessions, snakeSeed } from './format';
import { awardPoints } from './points';
import type {
  ArenaEntry,
  DayPlace,
  Finish,
  QualiLap,
  RaceCard,
  RaceResult,
  SessionPlan,
  SessionResult,
} from './types';

/** Laps of a qualifying run. Every one is timed; the best counts. */
export const QUALI_LAPS = 3;
/** A car with no gate for this long has parked it in the wall — retirement. */
const STUCK_LIMIT = 480;

function maxStepsFor(laps: number): number {
  return laps * 900 + 600;
}

/**
 * Rewards do not exist during a race — the network is frozen and only its greedy
 * action matters — but the environment still needs a table, so it gets the
 * defaults. Using each model's own training rewards here would change nothing
 * except make two identical cars simulate differently.
 */
const RACE_REWARDS = defaultRewards(RACING_SPEC);

export interface SimCar {
  entryId: string;
  policy: Policy;
}

/**
 * One race, steppable.
 *
 * The broadcast steps this in real time and the result computation runs it flat
 * out. Both go through the same code, which is the point: what a viewer watches
 * is what the timing sheet records.
 */
export class SessionSim {
  readonly env: RacingEnv;
  readonly cars: SimCar[];
  readonly totalLaps: number;
  done = false;

  private readonly obs = new Float32Array(OBS_SIZE);
  private readonly actions: Int32Array;
  /** Classification at the end of each completed lap, per car. */
  private readonly lapPositions: number[][];
  private readonly seenLaps: number[];

  constructor(trackId: string, laps: number, cars: SimCar[], seed: number) {
    this.cars = cars;
    this.totalLaps = laps;
    this.actions = new Int32Array(cars.length);
    this.lapPositions = cars.map(() => []);
    this.seenLaps = cars.map(() => 0);
    this.env = new RacingEnv(
      {
        trackId,
        nCars: cars.length,
        laps,
        carCollisions: true,
        maxSteps: maxStepsFor(laps),
        stuckLimit: STUCK_LIMIT,
      },
      RACE_REWARDS,
    );
    this.env.reset(seed);
  }

  step(): void {
    if (this.done) return;
    const env = this.env;
    for (let i = 0; i < this.cars.length; i++) {
      if (env.isAgentDone(i)) {
        this.actions[i] = 4; // coast, straight — ignored for finished cars anyway
        continue;
      }
      env.observe(i, this.obs);
      this.actions[i] = this.cars[i].policy.act(this.obs);
    }
    const res = env.step(this.actions);
    for (let i = 0; i < this.cars.length; i++) {
      const laps = env.score(i);
      while (this.seenLaps[i] < laps) {
        this.seenLaps[i]++;
        this.lapPositions[i].push(env.rankOf(i) + 1);
      }
    }
    if (res.allDone) this.done = true;
  }

  runToEnd(): void {
    const cap = maxStepsFor(this.totalLaps) + 10;
    for (let s = 0; s < cap && !this.done; s++) this.step();
    this.done = true;
  }

  /** Fast-forward without rendering — how a late viewer joins a race in progress. */
  advanceTo(elapsedMs: number): void {
    const target = Math.floor(elapsedMs / STEP_MS);
    while (!this.done && this.env.step_ < target) this.step();
  }

  snapshot(): RacingSnapshot {
    return this.env.snapshot();
  }

  result(sessionId: string, grid: string[]): SessionResult {
    const env = this.env;
    const order: number[] = [];
    for (let i = 0; i < this.cars.length; i++) order.push(i);
    order.sort((a, b) => env.rankOf(a) - env.rankOf(b));

    let winnerMs: number | null = null;
    let fastest: { entryId: string; ms: number } | null = null;

    const classification: Finish[] = order.map((car, idx) => {
      const t = env.telemetry(car);
      if (idx === 0) winnerMs = t.totalMs;
      if (t.bestLapMs !== null && (fastest === null || t.bestLapMs < fastest.ms)) {
        fastest = { entryId: this.cars[car].entryId, ms: t.bestLapMs };
      }
      return {
        entryId: this.cars[car].entryId,
        position: idx + 1,
        laps: t.laps,
        totalMs: t.totalMs,
        gapMs: t.totalMs !== null && winnerMs !== null && idx > 0 ? t.totalMs - winnerMs : null,
        bestLapMs: t.bestLapMs,
        bestSectorsMs: t.bestSectorsMs,
        lapTimesMs: t.lapTimesMs,
        lapPositions: this.lapPositions[car],
        topSpeed: t.topSpeed,
        overtakes: t.overtakes,
        wallHits: t.wallHits,
        carHits: t.carHits,
        lapsLed: t.lapsLed,
        status: t.finished ? 'finished' : 'dnf',
        gridPos: grid.indexOf(this.cars[car].entryId) + 1,
      };
    });

    return { sessionId, grid, classification, fastestLap: fastest };
  }
}

/**
 * One timed run per car on an empty circuit. The grid comes from this, and so
 * does the pole-position statistic. Every car starts from the identical slot
 * with the identical seed, so the only variable is the driving.
 */
export function runQualifying(
  entries: ArenaEntry[],
  weights: Map<string, string>,
  trackId: string,
  seed: number,
): QualiLap[] {
  const laps: QualiLap[] = [];
  for (const e of entries) {
    const w = weights.get(e.id);
    if (!w) {
      laps.push({ entryId: e.id, bestLapMs: null, sectorsMs: [null, null, null], topSpeed: 0 });
      continue;
    }
    const policy = Policy.fromBase64(e.arch.obsSize, e.arch.hidden, e.arch.nActions, w);
    const sim = new SessionSim(trackId, QUALI_LAPS, [{ entryId: e.id, policy }], seed);
    sim.runToEnd();
    const t = sim.env.telemetry(0);
    laps.push({ entryId: e.id, bestLapMs: t.bestLapMs, sectorsMs: t.bestSectorsMs, topSpeed: t.topSpeed });
  }
  // No time at all means no clean lap; those cars line up at the back.
  return laps.sort((a, b) => {
    if (a.bestLapMs === null && b.bestLapMs === null) return 0;
    if (a.bestLapMs === null) return 1;
    if (b.bestLapMs === null) return -1;
    return a.bestLapMs - b.bestLapMs;
  });
}

export function qualifyingOrder(quali: QualiLap[]): string[] {
  return quali.map((q) => q.entryId);
}

export function policiesFor(
  ids: string[],
  entries: Map<string, ArenaEntry>,
  weights: Map<string, string>,
): SimCar[] {
  const out: SimCar[] = [];
  for (const id of ids) {
    const e = entries.get(id);
    const w = weights.get(id);
    if (!e || !w) continue;
    out.push({ entryId: id, policy: Policy.fromBase64(e.arch.obsSize, e.arch.hidden, e.arch.nActions, w) });
  }
  return out;
}

/** Grid for a session, resolving the heats that are fed by an earlier round. */
export function gridFor(session: SessionPlan, resolved: Map<string, string[]>): string[] {
  return session.grid.length ? session.grid : (resolved.get(session.id) ?? []);
}

/**
 * Seed the next round from the cars that got through.
 *
 * Heat winners fill the front of it, then all the runners-up, and so on. That is
 * the order every real heats-into-final format uses, and it makes winning your
 * heat worth something beyond survival.
 */
function advancingOrder(round: SessionPlan[], results: Map<string, SessionResult>): string[] {
  const byPlace: string[][] = [];
  round.forEach((session, groupIdx) => {
    const res = results.get(session.id);
    if (!res) return;
    res.classification.slice(0, session.advance).forEach((f, place) => {
      (byPlace[place] ??= [])[groupIdx] = f.entryId;
    });
  });
  return byPlace.flatMap((row) => (row ?? []).filter(Boolean));
}

/** Groups the sessions of a day by elimination round, in running order. */
export function roundsOf(sessions: SessionPlan[]): Map<number, SessionPlan[]> {
  const rounds = new Map<number, SessionPlan[]>();
  for (const s of sessions) {
    const list = rounds.get(s.round) ?? [];
    list.push(s);
    rounds.set(s.round, list);
  }
  return rounds;
}

/**
 * Run a whole race day and classify it. Deterministic: the same card and the
 * same weights always produce the same result, which is what lets anyone replay
 * a race and watch exactly what the timing sheet recorded.
 */
export function runRaceDay(card: RaceCard, weights: Map<string, string>): RaceResult {
  const entries = new Map(card.entries.map((e) => [e.id, e]));
  const order = qualifyingOrder(card.qualifying);
  const sessions = planSessions(order);
  const resolved = new Map<string, string[]>();
  const results = new Map<string, SessionResult>();
  const sessionResults: SessionResult[] = [];
  const rounds = roundsOf(sessions);
  const roundKeys = [...rounds.keys()].sort((a, b) => a - b);

  for (const r of roundKeys) {
    const group = rounds.get(r)!;
    for (const session of group) {
      const grid = gridFor(session, resolved);
      const cars = policiesFor(grid, entries, weights);
      if (cars.length === 0) continue;
      const sim = new SessionSim(card.trackId, lapsFor(session), cars, card.seed + session.offsetMs);
      sim.runToEnd();
      const res = sim.result(session.id, grid);
      results.set(session.id, res);
      sessionResults.push(res);
    }
    const next = rounds.get(r + 1);
    if (next) {
      const through = advancingOrder(group, results);
      if (next.length === 1) {
        resolved.set(next[0].id, through);
      } else {
        snakeSeed(through, next.length).forEach((g, i) => resolved.set(next[i].id, g));
      }
    }
  }

  // --- day classification ---
  type PendingPlace = Omit<DayPlace, 'points' | 'classified'> & { laps: number };
  const places: PendingPlace[] = [];
  const seen = new Set<string>();
  const finalSession = sessions[sessions.length - 1];
  const finalRes = results.get(finalSession.id);
  if (finalRes) {
    for (const f of finalRes.classification) {
      places.push({
        entryId: f.entryId,
        position: places.length + 1,
        eliminatedIn: null,
        status: f.status,
        laps: f.laps,
      });
      seen.add(f.entryId);
    }
  }
  // Everyone knocked out earlier is classified behind the finalists, latest
  // round first, and within a round by where they finished their heat.
  for (const r of [...roundKeys].reverse()) {
    const rows: Array<{ entryId: string; pos: number; status: 'finished' | 'dnf'; session: string; laps: number }> = [];
    for (const session of rounds.get(r)!) {
      const res = results.get(session.id);
      if (!res) continue;
      for (const f of res.classification) {
        if (seen.has(f.entryId)) continue;
        rows.push({ entryId: f.entryId, pos: f.position, status: f.status, session: session.id, laps: f.laps });
      }
    }
    rows.sort((a, b) => a.pos - b.pos);
    for (const row of rows) {
      seen.add(row.entryId);
      places.push({
        entryId: row.entryId,
        position: places.length + 1,
        eliminatedIn: row.session,
        status: row.status,
        laps: row.laps,
      });
    }
  }
  // Entrants whose weights failed to load never took the start.
  for (const e of card.entries) {
    if (seen.has(e.id)) continue;
    places.push({ entryId: e.id, position: places.length + 1, eliminatedIn: null, status: 'dnf', laps: 0 });
  }

  let fastest: { entryId: string; ms: number } | null = null;
  for (const res of sessionResults) {
    if (res.fastestLap && (fastest === null || res.fastestLap.ms < fastest.ms)) fastest = res.fastestLap;
  }

  return {
    raceId: card.id,
    seasonId: card.seasonId,
    computedAt: Date.now(),
    sessions: sessionResults,
    places: awardPoints(places, fastest ? fastest.entryId : null, places[0]?.laps ?? 0),
    pole: order[0] ?? null,
    fastestLap: fastest,
  };
}
