/*
 * A test push to one team's devices, run from the "Test push" workflow - to
 * check that a notification reaches a phone, and how fast, without waiting for
 * a race. Sent like the race pushes, at high urgency. `--dry` only finds the
 * devices and sends nothing.
 *
 *   node testPush.js <team name> [--dry]
 */
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

const SITE = 'https://reinforcement-learning-ed0ed.web.app/';

// The key a team name is stored under (nameKey in src/core/champ/names.ts).
function nameKey(name) {
  return encodeURIComponent(name.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US'));
}

async function main() {
  const team = process.argv[2] || '';
  const dry = process.argv.includes('--dry');
  initializeApp({ projectId: process.env.PROJECT_ID });
  const db = getFirestore();

  const named = await db.collection('names').doc(nameKey(team)).get();
  if (!named.exists) throw new Error(`No team named "${team}".`);
  const uid = named.data().uid;
  const snap = await db.collection('pushTokens').where('uid', '==', uid).get();
  console.log(`${team}: ${snap.size} device(s) with notifications on.`);
  if (dry || !snap.size) return;

  const time = new Date().toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });
  const res = await getMessaging().sendEach(
    snap.docs.map((d) => ({
      token: d.data().token,
      notification: { title: 'RL Arena - בדיקה', body: `התראת בדיקה שנשלחה ב-${time}.` },
      data: { url: SITE, tag: 'test' },
      webpush: { headers: { Urgency: 'high', TTL: '3600' }, fcmOptions: { link: SITE } },
    })),
  );
  res.responses.forEach((r, i) => console.log(`device ${i + 1}: ${r.success ? 'sent' : r.error.code}`));
  if (!res.successCount) process.exit(1);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
