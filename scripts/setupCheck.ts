/**
 * Is every car setup a trade-off? The braking reference driver (`drivers.ts`)
 * at its best, on every circuit, with each setup. A setup that is fastest
 * everywhere would be an upgrade, not a choice - so each one has to be beaten
 * somewhere, and the balanced car must not lose everywhere either.
 *
 *   npx tsx scripts/setupCheck.ts            the table
 *   npx tsx scripts/setupCheck.ts --check    the same, exiting 1 on a failure
 */
import { PHYSICS_VERSION } from '../src/core/games/racing/env';
import { TRACK_DEFS } from '../src/core/games/racing/tracks';
import { SETUPS, TRACK_CHARACTER } from '../src/core/games/racing/setup';
import { setupTable, setupsAreTradeOffs } from './drivers';

const table = setupTable(PHYSICS_VERSION);
const fmt = (ms: number | null) => (ms === null ? '   DNF ' : (ms / 1000).toFixed(2).padStart(7));
console.log(`${'circuit'.padEnd(10)} ${SETUPS.map((s) => s.id.padStart(10)).join(' ')}   fastest`);
for (const def of TRACK_DEFS) {
  const row = table.get(def.id)!;
  const best = SETUPS.reduce((a, b) => ((row.get(b.id) ?? Infinity) < (row.get(a.id) ?? Infinity) ? b : a));
  const note = TRACK_CHARACTER[def.id] === best.id ? '' : `   (TRACK_CHARACTER says ${TRACK_CHARACTER[def.id] ?? 'nothing'})`;
  console.log(`${def.id.padEnd(10)} ${SETUPS.map((s) => fmt(row.get(s.id) ?? null).padStart(10)).join(' ')}   ${best.id}${note}`);
}
const problem = setupsAreTradeOffs(table);
if (process.argv.includes('--check')) {
  console.log(problem ? `\n${problem}` : '\nevery setup wins somewhere and loses somewhere');
  process.exit(problem ? 1 : 0);
}
