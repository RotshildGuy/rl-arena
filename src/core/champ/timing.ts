import { planSessions, SESSION_GAP_MS } from './format';
import { BROADCAST_OPENS_MS } from './schedule';
import { qualifyingOrder } from './sim';
import type { RaceCard, RaceResult, SessionPlan } from './types';

export interface SessionWindow {
  session: SessionPlan;
  startsAt: number;
  endsAt: number;
}

/**
 * A retired car is declared out some seconds after its last gate, so a session
 * outlives its last recorded lap by about that much.
 */
const RETIREMENT_GRACE_MS = 8000;

/**
 * When each session of a race day is on air.
 *
 * A session's slot is the gap to the next one, whether or not the racing fills
 * it — a broadcast that ran until the last car happened to stop would start the
 * next session at a different moment for every viewer.
 */
export function sessionWindows(card: RaceCard): SessionWindow[] {
  return planSessions(qualifyingOrder(card.qualifying)).map((session) => ({
    session,
    startsAt: card.startsAt + session.offsetMs,
    endsAt: card.startsAt + session.offsetMs + SESSION_GAP_MS,
  }));
}

/**
 * How long the racing in a session actually lasted, from its stored result.
 *
 * The whole day is simulated the moment the lights go out, so this is known
 * before anybody has watched it: the last car home, or a retirement plus the
 * delay before it is declared out. It is what separates "the race is still on"
 * from "the race is over and we are waiting for the next one".
 */
export function sessionRacingMs(result: RaceResult | null | undefined, sessionId: string): number | null {
  const session = result?.sessions.find((s) => s.sessionId === sessionId);
  if (!session) return null;
  let max = 0;
  for (const f of session.classification) {
    const ran = f.lapTimesMs.reduce((a, b) => a + b, 0);
    const t = f.totalMs ?? ran + RETIREMENT_GRACE_MS;
    if (t > max) max = t;
  }
  return max > 0 ? Math.ceil(max / 1000) * 1000 : null;
}

/** When the flag falls on a session — never later than the end of its slot. */
export function sessionEndsAt(w: SessionWindow, result: RaceResult | null | undefined): number {
  const ms = sessionRacingMs(result, w.session.id);
  return ms === null ? w.endsAt : Math.min(w.endsAt, w.startsAt + ms);
}

/**
 * When the feed opens: a little before the first session's lights, so a viewer
 * can be sitting on the grid when they go out instead of arriving to an empty
 * pit straight. Only the first session needs this — the sessions after it run
 * back to back, and anybody watching is already inside the broadcast.
 */
export function broadcastOpensAt(card: RaceCard): number {
  const windows = sessionWindows(card);
  const first = windows.length ? windows[0].startsAt : card.startsAt;
  return first - BROADCAST_OPENS_MS;
}

/**
 * The session on air, counting the minute before the day's first lights.
 *
 * Before the start the session returned has not begun: it is the one the
 * broadcast is counting down to, and its own clock still reads zero.
 */
export function liveSession(card: RaceCard, now: number): SessionWindow | null {
  const windows = sessionWindows(card);
  if (!windows.length) return null;
  if (now < windows[0].startsAt) return now >= broadcastOpensAt(card) ? windows[0] : null;
  return windows.find((w) => now >= w.startsAt && now < w.endsAt) ?? null;
}

export type DayPhase = 'upcoming' | 'racing' | 'interval' | 'done';

export interface DayStatus {
  phase: DayPhase;
  /** The session whose slot we are inside, racing or already flagged. */
  current: SessionWindow | null;
  /** When the flag falls on `current`. */
  currentEndsAt: number;
  /** The session that follows it, for the countdown between sessions. */
  next: SessionWindow | null;
  /** Sessions whose flag has already fallen — their results may be shown. */
  finished: Set<string>;
}

/**
 * Where a race day is right now.
 *
 * The distinction that matters is between *racing* and *between sessions*. A
 * session's slot is three minutes but the racing rarely fills it, and counting
 * up to 180 while nothing is happening tells the viewer nothing: what they want
 * to know is how long until the next one, and what just happened in the one that
 * ended. Once the last session is flagged the day is over immediately — there is
 * nothing left to protect by holding the results back.
 */
export function dayStatus(card: RaceCard, result: RaceResult | null | undefined, now: number): DayStatus {
  const windows = sessionWindows(card);
  const finished = new Set<string>();
  if (!windows.length) {
    return { phase: 'done', current: null, currentEndsAt: 0, next: null, finished };
  }

  for (const w of windows) {
    if (now >= sessionEndsAt(w, result)) finished.add(w.session.id);
  }

  if (now < windows[0].startsAt) {
    return { phase: 'upcoming', current: null, currentEndsAt: 0, next: windows[0], finished };
  }

  const last = windows[windows.length - 1];
  if (now >= sessionEndsAt(last, result)) {
    return { phase: 'done', current: last, currentEndsAt: sessionEndsAt(last, result), next: null, finished };
  }

  const index = windows.findIndex((w) => now >= w.startsAt && now < w.endsAt);
  const current = index >= 0 ? windows[index] : last;
  const currentEndsAt = sessionEndsAt(current, result);
  return {
    phase: now < currentEndsAt ? 'racing' : 'interval',
    current,
    currentEndsAt,
    next: windows[index + 1] ?? null,
    finished,
  };
}

export type DayState = 'upcoming' | 'live' | 'done';

/**
 * Whether a day is still to come, on air, or over — where "on air" starts with
 * the feed rather than with the lights, so the screens that offer a way in
 * offer it before the race has moved.
 */
export function dayState(card: RaceCard, now: number, result?: RaceResult | null): DayState {
  const phase = dayStatus(card, result, now).phase;
  if (phase === 'done') return 'done';
  if (phase === 'upcoming') return now >= broadcastOpensAt(card) ? 'live' : 'upcoming';
  return 'live';
}

/**
 * Results stay sealed until the broadcast is over.
 *
 * The whole day is simulated the moment the lights go out, so without this the
 * classification would be sitting one tab away while people are still watching.
 * Per session, though: a heat that has taken the flag can be read while the next
 * one is still to come.
 */
export function resultsVisible(card: RaceCard, now: number, result?: RaceResult | null): boolean {
  return dayStatus(card, result, now).phase === 'done';
}

/**
 * The results a championship table may count.
 *
 * A race day is simulated the moment the lights go out, so its result exists
 * while people are still watching it. Feeding that straight into the standings
 * would put today's points on screen before today's race has been seen — so a
 * day joins the table when its final takes the flag, and not a second earlier.
 */
export function settledResults(
  cards: RaceCard[],
  results: Map<string, RaceResult>,
  now: number,
): Map<string, RaceResult> {
  const out = new Map<string, RaceResult>();
  for (const card of cards) {
    const result = results.get(card.id);
    if (result && dayStatus(card, result, now).phase === 'done') out.set(card.id, result);
  }
  return out;
}
