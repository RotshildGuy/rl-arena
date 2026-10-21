/*
 * Race notifications. The only code in RL Arena that runs on a server, and it
 * does no racing: the races are still run by whoever opens the site. These two
 * jobs only read what is already in Firestore and send a push:
 *
 *   19:45 Israel time  "the race starts in a quarter of an hour", to everyone
 *                      who turned reminders on;
 *   after the race     how each person's best car finished, the minute the
 *                      broadcast ends. Checked every minute from 20:00 to
 *                      21:59; the result only exists once somebody has opened
 *                      the site to run it, so a day nobody opened sends nothing.
 *                      pushSent/{raceId} records that a day's results went out.
 *   on a reply         when an operator answers a feedback message or moves
 *                      its status, its sender hears about it (`feedback.js`).
 *
 * Tokens live in pushTokens/{token} = { uid, token, createdAt, seenAt }:
 * createdAt is when the account was made, seenAt the last load that saved it.
 * A token the push service no longer knows is deleted on the spot.
 *
 * Deploy: `cd functions && npm install && cd .. && firebase deploy --only functions`.
 * Scheduled functions need the Blaze (pay-as-you-go) plan.
 */
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { dayEndsAt, raceIdForRound, roundOfDay } = require('./race');
const { feedbackChange } = require('./feedback');

initializeApp();
const db = getFirestore();
// A path, not an address: the site is served at two addresses, and the
// service worker opens it on the one where that device turned reminders on,
// where its sign-in lives.
const SITE = '/';
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

exports.raceResult = onSchedule({ schedule: '* 20-21 * * *', timeZone: 'Asia/Jerusalem', region: REGION }, async () => {
  const now = Date.now();
  const raceId = raceIdForRound(roundOfDay(now));
  const sent = db.collection('pushSent').doc(raceId);
  if ((await sent.get()).exists) return;
  const season = raceId.split('-')[0];
  const race = db.collection('seasons').doc(season).collection('races').doc(raceId);
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
