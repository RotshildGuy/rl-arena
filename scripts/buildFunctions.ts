/**
 * Build the race day for the functions: `src/server/raceDay.ts` and the app
 * code it uses, bundled into one CommonJS file, with the house cars' weights
 * copied beside it. Neither is in the repository; `firebase deploy` runs this
 * first (`predeploy` in firebase.json).
 *
 *   npm run build:functions
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import { HOUSE_IDS } from '../src/server/raceDay';

export function buildFunctions(outDir: string): void {
  buildSync({
    entryPoints: ['src/server/raceDay.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: join(outDir, 'raceDay.js'),
    logLevel: 'warning',
  });
  mkdirSync(join(outDir, 'house'), { recursive: true });
  for (const id of HOUSE_IDS) copyFileSync(join('public', 'house', `${id}.json`), join(outDir, 'house', `${id}.json`));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) buildFunctions('functions');
