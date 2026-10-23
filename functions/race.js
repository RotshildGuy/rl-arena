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

/** The entry list closes this long before the lights (LOCK_BEFORE_MS in schedule.ts). */
const LOCK_BEFORE_MS = 5 * 60 * 1000;

function lockAtForRound(round) {
  return startsAtForRound(round) - LOCK_BEFORE_MS;
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

/*
 * When a race day's broadcast ends: the flag on its last session. A copy of
 * planSessions (src/core/champ/format.ts) and sessionEndsAt
 * (src/core/champ/timing.ts), cut down to the last session. `npm run sanity`
 * checks it against the app's own answer.
 */
const GRID_SIZE = 10;
const SESSION_GAP_MS = 3 * 60 * 1000;
const RETIREMENT_GRACE_MS = 8000;

function dayEndsAt(card, result) {
  // Every heat round before the final takes one slot per group.
  let count = card.qualifying.length;
  let slots = 0;
  while (count > GRID_SIZE) {
    const groups = Math.ceil(count / GRID_SIZE);
    slots += groups;
    count = groups * Math.max(2, Math.floor(GRID_SIZE / groups));
  }
  const startsAt = card.startsAt + slots * SESSION_GAP_MS;
  const slotEnd = startsAt + SESSION_GAP_MS;
  const last = result && result.sessions.find((s) => s.sessionId === (slots ? 'final' : 'race'));
  if (!last) return slotEnd;
  let max = 0;
  for (const f of last.classification) {
    const ran = f.lapTimesMs.reduce((a, b) => a + b, 0);
    const t = f.totalMs != null ? f.totalMs : ran + RETIREMENT_GRACE_MS;
    if (t > max) max = t;
  }
  return max > 0 ? Math.min(slotEnd, startsAt + Math.ceil(max / 1000) * 1000) : slotEnd;
}

module.exports = { startsAtForRound, lockAtForRound, roundOfDay, seasonNumber, raceIdForRound, dayEndsAt };
