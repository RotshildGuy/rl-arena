/*
 * The arena, the way `FirestoreArena` (src/storage/arena.ts) lays it out -
 * only what a race day needs, on the admin SDK. Used by the race day in
 * `index.js` and by `backfillReplays.js`.
 *
 * Cards, their cars and results are created, never overwritten: admin writes
 * skip the security rules, so `create` is what keeps the server to the "first
 * record stands" rule. The server is the only reader of weights - the rules
 * keep them from everybody but their owner.
 */
function makeArena(db) {
  function raceRef(raceId) {
    return db.collection('seasons').doc(raceId.split('-')[0]).collection('races').doc(raceId);
  }

  const arena = {
    raceRef,
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
    /*
     * replay/{sessionId} = { sessionId, cars: { entryId: actions } }, one per
     * session (a final of ten cars is about 80 KB), and replay/index, written
     * last, saying which sessions there are - or that the day did not reproduce.
     */
    async hasReplay(raceId) {
      return (await raceRef(raceId).collection('replay').doc('index').get()).exists;
    },
    async putReplay(raceId, replay) {
      const col = raceRef(raceId).collection('replay');
      if (!replay) {
        await col.doc('index').set({ sessions: [], reproduced: false });
        return;
      }
      for (const [sessionId, cars] of replay) await col.doc(sessionId).set({ sessionId, cars });
      await col.doc('index').set({ sessions: [...replay.keys()], reproduced: true });
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
  return arena;
}

module.exports = { makeArena };
