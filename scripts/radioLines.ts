/**
 * Every line of the broadcast's team radio (he/broadcast.ts), once each, with
 * who says it - for `radioGemini.py` to record.
 *
 *   npx tsx scripts/radioLines.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { he } from '../src/i18n/he';

const out: Array<{ who: string; text: string }> = [];
const seen = new Set<string>();
for (const takes of Object.values(he.broadcast.radio)) {
  for (const take of takes) {
    for (const [who, text] of take) {
      const k = `${who}|${text}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ who, text });
    }
  }
}
mkdirSync('node_modules/.cache', { recursive: true });
writeFileSync('node_modules/.cache/radioLines.json', JSON.stringify(out, null, 1));
console.log(`${out.length} lines`);
