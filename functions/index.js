/*
 * Race notifications. The only code in RL Arena that runs on a server, and it
 * does no racing: the races are still run by whoever opens the site. These two
 * jobs only read what is already in Firestore and send a push:
 *
 *   19:45 Israel time  "the race starts in a quarter of an hour", to everyone
 *                      who turned reminders on;
 *   20:45 Israel time  how each person's best car finished, if the result has
 *                      been published by then (somebody has to have opened
 *                      the site to run it) - otherwise nothing.
 *
 * Tokens live in pushTokens/{token} = { uid, token, createdAt }. A token the
 * push service no longer knows is deleted on the spot.
 *
 * Deploy: `cd functions && npm install && cd .. && firebase deploy --only functions`.
 * Scheduled functions need the Blaze (pay-as-you-go) plan.
 */
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { raceIdForRound, roundOfDay } = require('./race');

initializeApp();
const db = getFirestore();
const SITE = 'https://reinforcement-learning-ed0ed.web.app/';
const REGION = 'me-west1';

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

function message(token, title, body, tag) {
  return {
    token,
    notification: { title, body },
    data: { url: SITE, tag },
    webpush: { fcmOptions: { link: SITE } },
  };
}

exports.raceReminder = onSchedule({ schedule: '45 19 * * *', timeZone: 'Asia/Jerusalem', region: REGION }, async () => {
  const tokens = await allTokens();
  await send(tokens.map((t) => message(t.token, 'RL Arena', 'המרוץ מתחיל בעוד רבע שעה. השידור נפתח דקה לפני.', 'reminder')));
});

exports.raceResult = onSchedule({ schedule: '45 20 * * *', timeZone: 'Asia/Jerusalem', region: REGION }, async () => {
  const round = roundOfDay(Date.now());
  const raceId = raceIdForRound(round);
  const season = raceId.split('-')[0];
  const race = db.collection('seasons').doc(season).collection('races').doc(raceId);
  const [cardSnap, resultSnap] = await Promise.all([race.get(), race.collection('result').doc('final').get()]);
  if (!cardSnap.exists || !resultSnap.exists) return;
  const card = cardSnap.data();
  const result = resultSnap.data();
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
