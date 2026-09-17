/**
 * End-to-end championship probe with genuinely trained models.
 *
 * Trains a handful of cars, builds a race card, runs the day and prints the
 * classification — then runs the whole thing again to confirm it is bit-for-bit
 * reproducible. That last check is the one that matters: the broadcast replays
 * a race by re-simulating it, so a result that is not reproducible is a
 * broadcast that disagrees with its own timing sheet.
 *
 *   npm run champ -- [cars] [generations]
 *   npm run champ -- 14 200      # enough entries to force heats and a final
 */
import { GaTrainer } from '../src/core/rl/ga';
import { encodeWeights } from '../src/core/nn/serialize';
import { defaultRewards } from '../src/core/games/types';
import { getGame } from '../src/core/games/registry';
import { buildRaceCard } from '../src/core/champ/card';
import { runRaceDay } from '../src/core/champ/sim';
import { planSessions } from '../src/core/champ/format';
import { OBS_SIZE, OBS_VERSION, ACTION_LABELS, RACING_SPEC } from '../src/core/games/racing/rewards';
import type { ArenaEntry } from '../src/core/champ/types';

const N = Number(process.argv[2] ?? 5);
const GENERATIONS = Number(process.argv[3] ?? 40);
const hidden = [48, 48];

const game = getGame('racing');
const config = { ...game.defaultConfig(), laps: 2, maxSteps: 1500, nCars: 4 };

function train(seed: number): string {
  const trainer = new GaTrainer({
    gameId: 'racing',
    config,
    rewards: defaultRewards(RACING_SPEC),
    hyper: { hidden, populationSize: 16 },
    seed,
  });
  for (let gens = 0; gens < GENERATIONS; ) {
    const s = trainer.stepOnce();
    if (s) gens++;
  }
  return encodeWeights(trainer.getWeights());
}

const entries: ArenaEntry[] = [];
const weights = new Map<string, string>();
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const w = train(100 + i * 31);
  const id = `e${i}`;
  weights.set(id, w);
  entries.push({
    id,
    uid: `u${i % 3}`,
    driver: `מודל ${i + 1}`,
    team: `קבוצה ${String.fromCharCode(65 + (i % 3))}`,
    gameId: 'racing',
    algorithm: 'ga',
    arch: { obsSize: OBS_SIZE, hidden, nActions: ACTION_LABELS.length },
    obsVersion: OBS_VERSION,
    tag: `M${i + 1}`,
    createdAt: 0,
    updatedAt: 0,
    modelId: `m${i}`,
    episodes: GENERATIONS,
  });
}
console.log(`אימון ${N} מודלים · ${GENERATIONS} דורות · ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

function fmt(ms: number | null): string {
  if (ms === null) return '—';
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return m > 0 ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3);
}

const t1 = Date.now();
const card = buildRaceCard(2, entries, weights);
console.log(`מסלול ${card.trackId} · ${card.entries.length} רשומים · מוקדמות:`);
card.qualifying.forEach((q, i) => {
  console.log(`  P${String(i + 1).padStart(2)}  ${q.entryId.padEnd(4)} ${fmt(q.bestLapMs).padStart(9)}   sectors ${q.sectorsMs.map(fmt).join(' / ')}`);
});

console.log('\nמקצים:', planSessions(card.qualifying.map((q) => q.entryId)).map((s) => `${s.id}(${s.name})`).join(' → '));

const result = runRaceDay(card, weights);
console.log(`\nחישוב יום מרוץ: ${((Date.now() - t1) / 1000).toFixed(1)}s`);

for (const session of result.sessions) {
  console.log(`\n${session.sessionId}  (זינוק: ${session.grid.join(', ')})`);
  for (const f of session.classification) {
    console.log(
      `  P${String(f.position).padStart(2)} ${f.entryId.padEnd(4)} ` +
        `grid ${String(f.gridPos).padStart(2)}  laps ${f.laps}  ` +
        `${f.status === 'dnf' ? 'DNF'.padStart(9) : fmt(f.totalMs).padStart(9)}  ` +
        `best ${fmt(f.bestLapMs).padStart(8)}  led ${f.lapsLed}  ot ${f.overtakes}  hits ${f.wallHits}  ` +
        `lapPos ${f.lapPositions.join('')}`,
    );
  }
}

console.log('\nסיווג היום:');
for (const p of result.places) {
  const e = entries.find((x) => x.id === p.entryId)!;
  console.log(`  ${String(p.position).padStart(2)}  ${e.driver}  ${e.team.padEnd(10)} ${String(p.points).padStart(3)} נק׳  ${p.status}`);
}
console.log(`pole=${result.pole}  fastestLap=${result.fastestLap ? `${result.fastestLap.entryId} ${fmt(result.fastestLap.ms)}` : '—'}`);

// --- determinism ---
const again = runRaceDay(buildRaceCard(2, entries, weights), weights);
const a = JSON.stringify(result.places) + JSON.stringify(result.sessions);
const b = JSON.stringify(again.places) + JSON.stringify(again.sessions);
console.log(`\nשחזוריות: ${a === b ? 'PASS — הרצה חוזרת זהה לחלוטין' : 'FAIL — התוצאה השתנתה'}`);
process.exit(a === b ? 0 : 1);
