import { buildStandings } from './points';
import type { RaceCard, RaceResult } from './types';

/**
 * "What happened to my car", one line per car.
 *
 * The last-result panel shows the podium and the pole, which is the race as a
 * spectator sees it. A team whose car finished seventh is not on it, and finding
 * out how its own day went meant opening the full report. Everything needed is
 * already in memory — the card, the results and the table — so this is arithmetic
 * over it, and no reads.
 */
export interface CarRecap {
  entryId: string;
  driver: string;
  team: string;
  tag: string;
  position: number;
  status: 'finished' | 'dnf';
  classified: boolean;
  points: number;
  /** Where the day started for it: its qualifying position. */
  startPos: number | null;
  /** Places gained (positive) or lost (negative) from the start to the flag. */
  gained: number | null;
  /** Its quickest lap of the day, over every session it ran. */
  bestLapMs: number | null;
  /** Whether that lap was the fastest of the day. */
  fastestOfDay: boolean;
  /** Championship position after the round, and before it (null if it was new). */
  standing: number | null;
  standingBefore: number | null;
}

/**
 * Pass the results the table may count (`settledResults`), so a race still on
 * air never shows up here before it has been seen. Empty when none of `uid`'s
 * cars raced in `card` — and then there is nothing new to say.
 */
export function carRecaps(
  card: RaceCard,
  cards: RaceCard[],
  results: Map<string, RaceResult>,
  uid: string,
): CarRecap[] {
  const result = results.get(card.id);
  if (!result) return [];
  const entries = new Map(card.entries.map((e) => [e.id, e]));
  const mine = result.places.filter((p) => entries.get(p.entryId)?.uid === uid);
  if (mine.length === 0) return [];

  const after = buildStandings({ cards, results }).drivers;
  const without = new Map(results);
  without.delete(card.id);
  const before = buildStandings({ cards: cards.filter((c) => c.id !== card.id), results: without }).drivers;
  // A driver's row is keyed by its newest entry, so look it up by any of them.
  const standingOf = (rows: typeof after, entryId: string) => {
    const row = rows.find((d) => d.entryIds.includes(entryId));
    // A car with no points and no start before this round has no place to lose.
    return row && row.starts > 0 ? row.position : null;
  };

  const quali = card.qualifying.map((q) => q.entryId);
  return mine.map((p) => {
    const e = entries.get(p.entryId)!;
    const index = quali.indexOf(p.entryId);
    const startPos = index >= 0 ? index + 1 : null;
    let bestLapMs: number | null = null;
    for (const s of result.sessions) {
      for (const f of s.classification) {
        if (f.entryId === p.entryId && f.bestLapMs !== null && (bestLapMs === null || f.bestLapMs < bestLapMs)) {
          bestLapMs = f.bestLapMs;
        }
      }
    }
    return {
      entryId: p.entryId,
      driver: e.driver,
      team: e.team,
      tag: e.tag,
      position: p.position,
      status: p.status,
      classified: p.classified,
      points: p.points,
      startPos,
      gained: startPos === null ? null : startPos - p.position,
      bestLapMs,
      fastestOfDay: result.fastestLap?.entryId === p.entryId,
      standing: standingOf(after, p.entryId),
      standingBefore: standingOf(before, p.entryId),
    };
  }).sort((a, b) => a.position - b.position);
}
