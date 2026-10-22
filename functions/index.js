/*
 * The only code in RL Arena that runs on a server: the race day itself, and
 * the notifications around it.
 *
 *   19:45 Israel time  "the race starts in a quarter of an hour", to everyone
 *                      who turned reminders on;
 *   from 19:55         the day's race. From the moment the entry list closes,
 *                      every minute to 21:59, the job makes sure the round has
 *                      its card and its result, running them itself
 *                      (`raceDay.js`) when no browser has yet - so the race
 *                      happens even if nobody opens the site. Browsers only
 *                      read a result once the lights are out, at 20:00.
 *   after the race     how each person's best car finished, the minute the
 *                      broadcast ends, from that same job.
 *                      pushSent/{raceId} records that a day's results went out.
 *   on a reply         when an operator answers a feedback message or moves
 *                      its status, its sender hears about it (`feedback.js`).
 *
 * Tokens live in pushTokens/{token} = { uid, token, createdAt, seenAt }:
 * createdAt is when the account was made, seenAt the last load that saved it.
 * A token the push service no longer knows is deleted on the spot.
 *
 * `raceDay.js` and `house/` are built from the app (`src/server/raceDay.ts`,
 * `public/house/`) by `npm run build:functions`, which `firebase deploy` runs
 * first (`predeploy` in firebase.json). They are not in the repository.
 *
 * Deploy: `npm ci && (cd functions && npm install) && firebase deploy --only functions`.
 * Scheduled functions need the Blaze (pay-as-you-go) plan.
 */
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { dayEndsAt, lockAtForRound, raceIdForRound, roundOfDay } = require('./race');
const { feedbackChange } = require('./feedback');
const { raceRound, HOUSE_IDS } = require('./raceDay');

initializeApp();
const db = getFirestore();
// A path, not an address: the site is served at two addresses, and the
// service worker opens it on the one where that device turned reminders on,
// where its sign-in lives.
const SITE = '/';
const REGION = 'me-west1';

// The house cars, from the copies of public/house/ the build puts here.
const HOUSE = new Map(HOUSE_IDS.map((id) => [id, require(`./house/${id}.json`).weightsB64]));

function raceRef(raceId) {
  return db.collection('seasons').doc(raceId.split('-')[0]).collection('races').doc(raceId);
}

/*
 * The arena, the way `FirestoreArena` (src/storage/arena.ts) reads and writes
 * it - only what a race day needs. Cards, their cars and results are created,
 * never overwritten: admin writes skip the security rules, so `create` is what
 * keeps the server to the same "first record stands" rule as the browsers.
 */
const arena = {
  async listEntries() {
    return (await db.collection('arena').get()).docs.map((d) => d.data());
  },
  async loadEntryWeights(id) {
    const snap = await db.collection('arena').doc(id).collection('data').doc('weights').get();
    return snap.exists ? (snap.data().weightsB64 ?? null) : null;
  },
  async getCard(raceId) {
    const snap = await raceRef(raceId).get();
    return snap.exists ? snap.data() : null;
  },
  async putCard(card, cars) {
    const race = raceRef(card.id);
    try {
      // Cars first: a card without its weights would be an unraceable record.
      const all = [...cars];
      for (let i = 0; i < all.length; i += 20) {
        const batch = db.batch();
        for (const [entryId, weightsB64] of all.slice(i, i + 20)) batch.create(race.collection('cars').doc(entryId), { entryId, weightsB64 });
        await batch.commit();
      }
      await race.create(card);
      return card;
    } catch (err) {
      // A browser got there first. Its card stands; if it has not landed yet,
      // the next minute's run finds it.
      const landed = await arena.getCard(card.id);
      if (landed) return landed;
      throw err;
    }
  },
  async loadRaceWeights(raceId) {
    const snap = await raceRef(raceId).collection('cars').get();
    return new Map(snap.docs.map((d) => [d.data().entryId, d.data().weightsB64]));
  },
  async getResult(raceId) {
    const snap = await raceRef(raceId).collection('result').doc('final').get();
    return snap.exists ? snap.data() : null;
  },
  async putResult(result) {
    try {
      await raceRef(result.raceId).collection('result').doc('final').create(result);
      return result;
    } catch (err) {
      const landed = await arena.getResult(result.raceId);
      if (landed) return landed;
      throw err;
    }
  },
};

async function allTokens() {
  const snap = await db.collection('pushTokens').get();
  return snap.docs.map((d) => d.data());
}

/** Send one message per token; forget the ones that are dead. */
async function send(messages) {
  for (let i = 0; i < messages.length; i += 500) {
    const batch = messages.slice(i, i + 500);
    const res = await getMessaging().sendEach(batch);
    await Promise.all(
      res.responses.map((r, j) => {
        const code = r.error && r.error.code;
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
          return db.collection('pushTokens').doc(batch[j].token).delete();
        }
        return null;
      }),
    );
  }
}

/*
 * High urgency: at the default, Android holds a push for a phone that is
 * asleep and hands it over at its next wake-up, which is how a result came in
 * a quarter of an hour late. `ttl` is how many seconds it is still worth
 * delivering - a reminder that turns up after the start is only noise.
 */
function message(token, title, body, tag, { url = SITE, ttl = 6 * 60 * 60 } = {}) {
  return {
    token,
    notification: { title, body },
    data: { url, tag },
    webpush: { headers: { Urgency: 'high', TTL: String(ttl) } },
  };
}

exports.raceReminder = onSchedule({ schedule: '45 19 * * *', timeZone: 'Asia/Jerusalem', region: REGION }, async () => {
  const tokens = await allTokens();
  await send(tokens.map((t) => message(t.token, 'RL Arena', 'המרוץ מתחיל בעוד רבע שעה. השידור נפתח דקה לפני.', 'reminder', { ttl: 15 * 60 })));
});

/*
 * A six-car day simulates in under a second; a full grid with heats takes a
 * few. The timeout is room for that on a cold start, not an expectation.
 *
 * Cron cannot say "19:55 to 21:59", so it runs from 19:00 and the ticks before
 * the lock return at once, without touching Firestore.
 */
const RACE_OPTIONS = { schedule: '* 19-21 * * *', timeZone: 'Asia/Jerusalem', region: REGION, memory: '512MiB', timeoutSeconds: 300 };

exports.raceResult = onSchedule(RACE_OPTIONS, async () => {
  const now = Date.now();
  const round = roundOfDay(now);
  // Not while the entry list is open: the field is only final from the lock.
  if (now < lockAtForRound(round)) return;
  const raceId = raceIdForRound(round);
  const sent = db.collection('pushSent').doc(raceId);
  if ((await sent.get()).exists) return;
  try {
    const outcome = await raceRound(arena, round, HOUSE);
    if (outcome !== 'already') console.log(`${raceId}: ${outcome}`);
  } catch (err) {
    // Next minute tries again, and a browser may yet run it.
    console.error(`${raceId}: race day failed`, err);
  }
  const race = raceRef(raceId);
  const [cardSnap, resultSnap] = await Promise.all([race.get(), race.collection('result').doc('final').get()]);
  if (!cardSnap.exists || !resultSnap.exists) return;
  const card = cardSnap.data();
  const result = resultSnap.data();
  // Not while people are still watching: the result exists from the lights.
  if (now < dayEndsAt(card, result)) return;
  // Claimed before sending, so two runs that overlap cannot both send.
  try {
    await sent.create({ at: now });
  } catch (err) {
    if (err.code === 6) return; // ALREADY_EXISTS
    throw err;
  }
  const owner = new Map(card.entries.map((e) => [e.id, e]));

  // Each account's best-placed car.
  const best = new Map();
  for (const p of result.places) {
    const e = owner.get(p.entryId);
    if (!e || e.uid === 'house') continue;
    const had = best.get(e.uid);
    if (!had || p.position < had.place.position) best.set(e.uid, { place: p, entry: e });
  }

  const tokens = await allTokens();
  const messages = [];
  for (const t of tokens) {
    const mine = best.get(t.uid);
    if (!mine) continue;
    const { place, entry } = mine;
    const how = place.status === 'dnf' ? 'פרש' : `סיים במקום ${place.position}`;
    const points = place.points ? ` (${place.points} נקודות)` : '';
    messages.push(message(t.token, card.name, `${entry.driver} ${how}${points}.`, 'result'));
  }
  await send(messages);
});

// An answer, or a status change, on somebody's feedback: tell them, on every
// device where they turned notifications on. The link opens the feedback page,
// where the answer is shown under their message.
exports.feedbackReply = onDocumentUpdated({ document: 'feedback/{id}', region: REGION }, async (event) => {
  const before = event.data && event.data.before.data();
  const after = event.data && event.data.after.data();
  const note = feedbackChange(before, after);
  if (!note || !after.uid) return;
  const snap = await db.collection('pushTokens').where('uid', '==', after.uid).get();
  const url = `${SITE}?open=feedback`;
  await send(snap.docs.map((d) => message(d.data().token, note.title, note.body, `feedback-${event.params.id}`, { url })));
});
