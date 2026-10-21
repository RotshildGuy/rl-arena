/*
 * The race calendar, for the server side. A copy of the few lines of
 * src/core/champ/schedule.ts that name a round and its race, because the
 * functions are deployed on their own and cannot import the app's TypeScript.
 * `npm run sanity` checks the two agree for years ahead - change both or neither.
 */
const SEASON_START_UTC = Date.UTC(2026, 9, 25);
const DAY_MS = 24 * 60 * 60 * 1000;
const SEASON_ROUNDS = 8;

function lastSunday(year, month) {
  const last = new Date(Date.UTC(year, month + 1, 0));
  return last.getUTCDate() - last.getUTCDay();
}

function israelOffsetAt20(year, month, day) {
  const start = Date.UTC(year, 2, lastSunday(year, 2) - 2);
  const end = Date.UTC(year, 9, lastSunday(year, 9));
  const at = Date.UTC(year, month, day);
  return at >= start && at < end ? 3 : 2;
}

function startsAtForRound(round) {
  const day = new Date(SEASON_START_UTC + (round - 1) * DAY_MS);
  const y = day.getUTCFullYear();
  const m = day.getUTCMonth();
  const d = day.getUTCDate();
  return Date.UTC(y, m, d, 20 - israelOffsetAt20(y, m, d));
}

/** The round whose lights go out on the Israeli calendar day of `now`. */
function roundOfDay(now) {
  let round = Math.floor((now - startsAtForRound(1)) / DAY_MS) + 1;
  // Adjust for the hour a clock change moves things, either way.
  while (round > 1 && startsAtForRound(round) - now > 20 * 60 * 60 * 1000) round--;
  while (now - startsAtForRound(round) > 4 * 60 * 60 * 1000) round++;
  return round;
}

function seasonNumber(round) {
  return 1 + Math.floor((Math.max(1, round) - 1) / SEASON_ROUNDS);
}

function raceIdForRound(round) {
  return `S${seasonNumber(round)}-R${String(round).padStart(3, '0')}`;
}

module.exports = { startsAtForRound, roundOfDay, seasonNumber, raceIdForRound };
