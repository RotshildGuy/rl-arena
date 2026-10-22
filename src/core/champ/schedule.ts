import { TRACK_DEFS } from '../games/racing/tracks';
import { t } from '../../i18n/dict';

/**
 * Seasons.
 *
 * The first season ran without an end, and under Formula 1 scoring anybody who
 * joined two weeks in sat at the bottom for good. From round 42 - the same
 * Sunday the car physics changes and the house team arrives - a season is
 * eight rounds: twice round the four circuits, about a week and a half. Each
 * one has its champions, then the table starts again from zero, and the cars
 * on the grid simply carry on into the next one.
 *
 * Season 1 is rounds 1 to 41 and stays exactly that: its race ids, its
 * Firestore path and its seeds are what they always were. Nothing is reset
 * retroactively.
 */
export const LEGACY_SEASON_LAST_ROUND = 41;
export const SEASON_ROUNDS = 8;

export function seasonNumber(round: number): number {
  if (round <= LEGACY_SEASON_LAST_ROUND) return 1;
  return 2 + Math.floor((round - LEGACY_SEASON_LAST_ROUND - 1) / SEASON_ROUNDS);
}

export function seasonId(n: number): string {
  return `S${n}`;
}

export function seasonForRound(round: number): string {
  return seasonId(seasonNumber(round));
}

/** First and last round of a season, inclusive. */
export function seasonRange(n: number): { first: number; last: number } {
  if (n <= 1) return { first: 1, last: LEGACY_SEASON_LAST_ROUND };
  const first = LEGACY_SEASON_LAST_ROUND + 1 + (n - 2) * SEASON_ROUNDS;
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

/** "Round 3 of 8" - where a round sits in its season. */
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
export const SEASON_START_UTC = Date.UTC(2026, 8, 14);
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
  const c = t().champ;
  if (minutes < 60) return c.minutes(minutes);
  const hours = Math.round(minutes / 60);
  return hours === 1 ? c.hour : c.hours(hours);
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
 * can be overdriven and walls cost time.
 *
 * Training switches the moment the code ships; the championship waits a few
 * days, because every car already on the grid learned to drive on the old
 * physics and its team needs time to retrain it. Until this round the cards
 * keep running on version 1, and a card records its version so the switch
 * never reaches back into a race that has already been run.
 */
export const PHYSICS_V2_ROUND = 42; // Sunday 25.10.2026

export function physicsForRound(round: number): number {
  return round >= PHYSICS_V2_ROUND ? 2 : 1;
}

/** Circuits rotate through the calendar, the way a real season does. */
export function trackForRound(round: number): string {
  return TRACK_DEFS[(round - 1) % TRACK_DEFS.length].id;
}

/**
 * The name stored on the round's card. Always the Hebrew one, so every client
 * writes the same card; screens show `grandPrixTitle` (i18n/names) instead.
 */
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
  // Salted with the first season's id for every season: the seed only has to
  // differ from round to round, and season 1's must never change.
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
