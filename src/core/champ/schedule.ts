import { TRACK_DEFS } from '../games/racing/tracks';

/**
 * Seasons.
 *
 * A season is eight rounds: twice round the four circuits, eight days. Each
 * one has its champions, then the table starts again from zero, and the cars
 * on the grid simply carry on into the next one.
 *
 * The calendar started over on Sunday 25.10.2026, the public launch: the
 * database was emptied that morning and that evening's race is round 1 of
 * season 1. The rounds raced before it (a test season that ran from 14.9) are
 * gone, and nothing here remembers them.
 */
export const SEASON_ROUNDS = 8;

export function seasonNumber(round: number): number {
  return 1 + Math.floor((Math.max(1, round) - 1) / SEASON_ROUNDS);
}

export function seasonId(n: number): string {
  return `S${n}`;
}

export function seasonForRound(round: number): string {
  return seasonId(seasonNumber(round));
}

/** First and last round of a season, inclusive. */
export function seasonRange(n: number): { first: number; last: number } {
  const first = 1 + (Math.max(1, n) - 1) * SEASON_ROUNDS;
  return { first, last: first + SEASON_ROUNDS - 1 };
}

/** The season a race belongs to, from its id - which is where it is stored. */
export function seasonOfRaceId(raceId: string): string {
  return raceId.split('-')[0];
}

/**
 * The season the screens show: that of the round on air, or of the last one
 * raced. So a season's final table stays up for the whole day after its last
 * race, and the new, empty one appears when the next race's feed opens.
 */
export function displaySeason(now = Date.now()): number {
  return seasonNumber(Math.max(1, airingRound(now)));
}

/** "סבב 3 מתוך 8" - where a round sits in its season. */
export function roundInSeason(round: number): { index: number; of: number } {
  const n = seasonNumber(round);
  const { first, last } = seasonRange(n);
  return { index: round - first + 1, of: last - first + 1 };
}

/**
 * The championship runs on one clock so that everyone, everywhere, is watching
 * the same race at the same moment: 20:00 in Israel, every day, summer and
 * winter. Which is 17:00 UTC under daylight saving and 18:00 UTC without it.
 *
 * The offset comes from Israel's rule written out below, not from the
 * browser's time-zone database. Every client must agree on when a round
 * starts - the card, the lock and the broadcast all hang off it - and a
 * browser with stale zone data would otherwise put the race an hour away from
 * everybody else's.
 */
export const SEASON_START_UTC = Date.UTC(2026, 9, 25); // round 1: Sunday 25.10.2026, the launch
export const RACE_HOUR_ISRAEL = 20;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Day of the month of the last Sunday in a month (`month` 0-based). */
function lastSunday(year: number, month: number): number {
  const last = new Date(Date.UTC(year, month + 1, 0));
  return last.getUTCDate() - last.getUTCDay();
}

/**
 * Israel's UTC offset at 20:00 on a given date, in hours.
 *
 * The law since 2013: summer time starts on the Friday before the last Sunday
 * of March and ends on the last Sunday of October, both at 02:00 - so by the
 * evening of either day the new offset already holds.
 */
export function israelOffsetAt20(year: number, month: number, day: number): number {
  const start = Date.UTC(year, 2, lastSunday(year, 2) - 2);
  const end = Date.UTC(year, 9, lastSunday(year, 9));
  const at = Date.UTC(year, month, day);
  return at >= start && at < end ? 3 : 2;
}

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

/**
 * How early the broadcast opens, before the lights go out.
 *
 * A button that appears at the moment of the start is a button you press after
 * the start: by the time it renders, is noticed and is tapped, the cars have
 * gone. So the feed opens on the grid a minute earlier and counts down to the
 * lights, and being there in time stops being a matter of reflexes.
 *
 * The cost is that the round's card - its qualifying and its grid - has to
 * exist before the round starts. That is safe only because the entry list has
 * already closed by then: everybody builds the card from the same frozen field
 * and gets the same card. Keep this shorter than `LOCK_BEFORE_MS`.
 */
export const BROADCAST_OPENS_MS = 60 * 1000;

/**
 * The round that is on air, which from a minute before its lights means the one
 * about to start. 0 before the season opens.
 */
export function airingRound(now = Date.now()): number {
  const next = currentRound(now) + 1;
  return now >= startsAtForRound(next) - BROADCAST_OPENS_MS ? next : currentRound(now);
}

/** How far back an unraced round will still be run when someone opens the app. */
export const MAX_BACKFILL_ROUNDS = 10;

/** Round 1 is the season's first day; every round after it is the next day, at 20:00 Israel time. */
export function startsAtForRound(round: number): number {
  const day = new Date(SEASON_START_UTC + (round - 1) * DAY_MS);
  const y = day.getUTCFullYear();
  const m = day.getUTCMonth();
  const d = day.getUTCDate();
  return Date.UTC(y, m, d, RACE_HOUR_ISRAEL - israelOffsetAt20(y, m, d));
}

export function lockAtForRound(round: number): number {
  return startsAtForRound(round) - LOCK_BEFORE_MS;
}

/** The most recent round whose lights have already gone out. 0 before round 1. */
export function currentRound(now = Date.now()): number {
  if (now < startsAtForRound(1)) return 0;
  // Rounds are a day apart give or take the hour a clock change moves them, so
  // the estimate is at most one off either way.
  let round = Math.floor((now - startsAtForRound(1)) / DAY_MS) + 1;
  while (startsAtForRound(round + 1) <= now) round++;
  while (round > 1 && startsAtForRound(round) > now) round--;
  return round;
}

/** The next round that has not started yet. */
export function nextRound(now = Date.now()): number {
  return currentRound(now) + 1;
}

export function raceIdForRound(round: number): string {
  return `${seasonForRound(round)}-R${String(round).padStart(3, '0')}`;
}

/**
 * The first round raced on version 2 of the car physics - the one where tyres
 * can be overdriven and walls cost time. Since the restart that is every
 * round; version 1 stays in the simulator because a card records the version
 * it ran on, and an old replay must still play back the way it raced.
 */
export const PHYSICS_V2_ROUND = 1;

export function physicsForRound(round: number): number {
  return round >= PHYSICS_V2_ROUND ? 2 : 1;
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
  // Salted with a fixed string: the seed only has to differ from round to round,
  // and it must never change once a round has been raced.
  for (const ch of 'S1') h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
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
