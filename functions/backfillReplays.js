/*
 * Give every race run before replays existed its replay, from the weights
 * frozen on its card, so it can still be watched once browsers can no longer
 * read those weights. Run from the "Backfill replays" workflow; safe to run
 * again - a race that has a replay, or was found not to reproduce, is skipped.
 * `--dry` only counts the races without one.
 *
 *   node backfillReplays.js [--dry]
 */
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { raceIdForRound, startsAtForRound } = require('./race');
const { replayRound } = require('./raceDay');
const { makeArena } = require('./arena');

async function main() {
  const dry = process.argv.includes('--dry');
  initializeApp({ projectId: process.env.PROJECT_ID });
  const arena = makeArena(getFirestore());

  const counts = {};
  for (let round = 1; startsAtForRound(round) < Date.now(); round++) {
    const raceId = raceIdForRound(round);
    const [card, result] = await Promise.all([arena.getCard(raceId), arena.getResult(raceId)]);
    if (!card || !result) continue;
    let outcome;
    if (dry) outcome = (await arena.hasReplay(raceId)) ? 'already' : 'missing';
    else outcome = await replayRound(arena, card, result);
    counts[outcome] = (counts[outcome] || 0) + 1;
    if (outcome !== 'already') console.log(`${raceId}: ${outcome}`);
  }
  console.log(JSON.stringify(counts));
  if (counts.mismatch) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
