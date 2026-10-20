/**
 * Can a dumb driver win? Flat out against braking, on every circuit, under each
 * version of the car physics. See `scripts/drivers.ts` for the two drivers.
 *
 *   npx tsx scripts/driverCheck.ts            the comparison table
 *   npx tsx scripts/driverCheck.ts --check    the same, exiting 1 on a failure
 */
import { PHYSICS_VERSION } from '../src/core/games/racing/env';
import { TRACK_DEFS } from '../src/core/games/racing/tracks';
import { LAPS, bestBraking, drive, flatOutLoses, type Outcome } from './drivers';

const fmt = (ms: number | null) => (ms === null ? '   —   ' : (ms / 1000).toFixed(2).padStart(7));
const describe = (o: Outcome) =>
  `${o.finished ? 'finish ' + fmt(o.totalMs) : `DNF ${o.laps}/${LAPS} laps `}  lap ${fmt(o.bestLapMs)}  walls ${String(o.wallHits).padStart(3)}`;

let failures = 0;
for (const physics of [1, PHYSICS_VERSION]) {
  console.log(`\nphysics v${physics}`);
  for (const def of TRACK_DEFS) {
    const flat = drive(def.id, physics, null);
    const brake = bestBraking(def.id, physics);
    const ok = flatOutLoses(flat, brake);
    if (physics === PHYSICS_VERSION && !ok) failures++;
    console.log(`  ${def.id.padEnd(10)} flat out: ${describe(flat)}   |   braking: ${describe(brake)}   ${ok ? 'flat out loses' : 'FLAT OUT IS GOOD ENOUGH'}`);
  }
}

if (process.argv.includes('--check')) {
  console.log(failures === 0 ? '\nflat out loses on every circuit' : `\n${failures} circuit(s) where flat out is good enough`);
  process.exit(failures === 0 ? 0 : 1);
}
