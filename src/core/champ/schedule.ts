import { TRACK_DEFS } from '../games/racing/tracks';

export const SEASON_ID = 'S1';

/**
 * The championship runs on a fixed clock so that everyone, everywhere, is
 * watching the same race at the same moment. UTC, not local time: a schedule
 * defined in local time would give every viewer a different race day.
 */
export const SEASON_START_UTC = Date.UTC(2026, 8, 14);
export const RACE_HOUR_UTC = 17; // 20:00 in Israel
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long before lights out the entry list closes.
 *
 * Short on purpose: the point of a lock is that the field cannot change while a
 * grid is being drawn up, not to make people commit hours in advance. Five
 * minutes is enough for that and still lets someone who finishes training at
 * 19:50 make the race.
 */
export const LOCK_BEFORE_MS = 5 * 60 * 1000;

/** The lead time in words, for the one sentence that has to spell it out. */
export function lockLeadText(): string {
  const minutes = Math.round(LOCK_BEFORE_MS / 60_000);
  if (minutes < 60) return `${minutes} דקות`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'שעה' : `${hours} שעות`;
}

/** How far back an unraced round will still be run when someone opens the app. */
export const MAX_BACKFILL_ROUNDS = 10;

/** Round 1 is the first race day on or after the season start. */
export function startsAtForRound(round: number): number {
  return SEASON_START_UTC + (round - 1) * DAY_MS + RACE_HOUR_UTC * 60 * 60 * 1000;
}

export function lockAtForRound(round: number): number {
  return startsAtForRound(round) - LOCK_BEFORE_MS;
}

/** The most recent round whose lights have already gone out. 0 before round 1. */
export function currentRound(now = Date.now()): number {
  if (now < startsAtForRound(1)) return 0;
  return Math.floor((now - startsAtForRound(1)) / DAY_MS) + 1;
}

/** The next round that has not started yet. */
export function nextRound(now = Date.now()): number {
  return currentRound(now) + 1;
}

export function raceIdForRound(round: number): string {
  return `${SEASON_ID}-R${String(round).padStart(3, '0')}`;
}

/** Circuits rotate through the calendar, the way a real season does. */
export function trackForRound(round: number): string {
  return TRACK_DEFS[(round - 1) % TRACK_DEFS.length].id;
}

export function grandPrixName(round: number): string {
  const track = TRACK_DEFS[(round - 1) % TRACK_DEFS.length];
  return `גרנד פרי ${track.name}`;
}

/**
 * Deterministic per-round seed. Everyone simulating the same round must start
 * the grid jitter from the same number or the results will not agree.
 */
export function seedForRound(round: number): number {
  let h = 2166136261 ^ round;
  for (const ch of SEASON_ID) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % 1_000_000_007;
}

export function roundsToBackfill(now = Date.now()): number[] {
  const last = currentRound(now);
  if (last < 1) return [];
  const first = Math.max(1, last - MAX_BACKFILL_ROUNDS + 1);
  const out: number[] = [];
  for (let r = first; r <= last; r++) out.push(r);
  return out;
}
