/*
/*
 * The only code in RL Arena that runs on a server: the race day itself.
 *
 *   from 19:55 Israel time  the day's race. From the moment the entry list
 *                           closes, every minute to 21:59, the job makes sure
 *                           the round has its card, its replay and its result,
 *                           running them itself (`raceDay.js`). This is the only
 *                           place the championship is raced: the security rules
 *                           let no browser write a card, a car or a result, and
 *                           no browser can read anybody else's weights - they
 *                           watch from the replay, and read a result only once
 *                           the lights are out, at 20:00.
 *
 * The push notifications that used to live here were removed (Chrome on
 * Android held them until the phone woke, so they arrived too late to help).
 *
 * `raceDay.js` and `house/` are built from the app (`src/server/raceDay.ts`,
 * `public/house/`) by `npm run build:functions`, which `firebase deploy` runs
 * first (`predeploy` in firebase.json). They are not in the repository.
 *
 * Deploy: `npm ci && (cd functions && npm install) && firebase deploy --only functions`.
 * Scheduled functions need the Blaze (pay-as-you-go) plan.
 */
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { lockAtForRound, raceIdForRound, roundOfDay } = require('./race');
const { raceRound, HOUSE_IDS } = require('./raceDay');
const { makeArena } = require('./arena');

initializeApp();
const db = getFirestore();
const REGION = 'me-west1';

// The house cars, from the copies of public/house/ the build puts here.
const HOUSE = new Map(HOUSE_IDS.map((id) => [id, require(`./house/${id}.json`).weightsB64]));

const arena = makeArena(db);

/*
 * A six-car day simulates in under a second; a full grid with heats takes a
 * few. The timeout is room for that on a cold start, not an expectation.
 *
 * Cron cannot say "19:55 to 21:59", so it runs from 19:00 and the ticks before
 * the lock return at once, without touching Firestore. Once the day has its
 * result and replay, a tick costs three reads.
 */
const RACE_OPTIONS = { schedule: '* 19-21 * * *', timeZone: 'Asia/Jerusalem', region: REGION, memory: '512MiB', timeoutSeconds: 300 };

exports.raceResult = onSchedule(RACE_OPTIONS, async () => {
  const now = Date.now();
  const round = roundOfDay(now);
  // Not while the entry list is open: the field is only final from the lock.
  if (now < lockAtForRound(round)) return;
  const raceId = raceIdForRound(round);
  try {
    const outcome = await raceRound(arena, round, HOUSE);
    if (outcome !== 'already') console.log(`${raceId}: ${outcome}`);
  } catch (err) {
    // Next minute tries again.
    console.error(`${raceId}: race day failed`, err);
  }
});
