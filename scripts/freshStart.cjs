/*
 * Empty the database for a fresh start, keeping the accounts people signed in
 * with. Written for the public launch on 25.10.2026 (see README, "התחלה
 * מחדש"), and safe to run again: an empty database stays empty.
 *
 *   node scripts/freshStart.cjs          shows what would go, deletes nothing
 *   node scripts/freshStart.cjs --yes    deletes it
 *
 * Deleted: every Firestore collection (cars, models, races, standings, team
 * names, leagues, shop, feedback, metrics...) except `pushTokens`, so whoever
 * turned race reminders on keeps getting them. And every anonymous account in
 * Firebase Auth - a visitor who never signed in starts again as a new one.
 * Kept: accounts with a sign-in method (Google, email). They lose everything
 * they had, but not the account.
 *
 * Runs with the Admin SDK, so the Firestore rules do not apply to it. It needs
 * the project's credentials: either `gcloud auth application-default login`,
 * or a service-account key (Firebase console -> Project settings -> Service
 * accounts -> Generate new private key) named in GOOGLE_APPLICATION_CREDENTIALS.
 * The SDK is the one the functions use: `cd functions && npm install` first.
 */
const path = require('path');

const fromFunctions = (name) => require(require.resolve(name, { paths: [path.join(__dirname, '..', 'functions')] }));
const { initializeApp } = fromFunctions('firebase-admin/app');
const { getFirestore } = fromFunctions('firebase-admin/firestore');
const { getAuth } = fromFunctions('firebase-admin/auth');

const PROJECT_ID = 'reinforcement-learning-ed0ed';
const KEEP = new Set(['pushTokens']);
const apply = process.argv.includes('--yes');

initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();
const auth = getAuth();

async function anonymousUids() {
  const out = [];
  let page;
  do {
    const res = await auth.listUsers(1000, page);
    for (const u of res.users) if (u.providerData.length === 0) out.push(u.uid);
    page = res.pageToken;
  } while (page);
  return out;
}

async function main() {
  console.log(`${apply ? 'Deleting' : 'Would delete (dry run, add --yes to delete)'} in ${PROJECT_ID}:\n`);

  const collections = await db.listCollections();
  for (const col of collections) {
    if (KEEP.has(col.id)) {
      console.log(`  keep     ${col.id}`);
      continue;
    }
    // listDocuments, not a query: `users/{uid}` exists only as the parent of
    // its models, and a query would not count it.
    const count = (await col.listDocuments()).length;
    console.log(`  delete   ${col.id} (${count} documents and everything under them)`);
    if (apply) await db.recursiveDelete(col);
  }

  const anon = await anonymousUids();
  console.log(`\n  delete   ${anon.length} anonymous accounts`);
  if (apply) {
    for (let i = 0; i < anon.length; i += 1000) {
      const res = await auth.deleteUsers(anon.slice(i, i + 1000));
      if (res.failureCount) console.log(`           ${res.failureCount} could not be deleted - run again`);
    }
  }
  console.log(apply ? '\nDone.' : '\nNothing was deleted.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
