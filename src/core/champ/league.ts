import type { RaceCard, RaceResult } from './types';

/**
 * A table of some of the competitors - the rookies' table - is a filter, not a
 * second championship: the same races, with only their cars and the points
 * those cars actually scored.
 *
 * (Season 4 removed the friends' leagues that used to share this; nobody had
 * made one.)
 */

/**
 * The season as a group of accounts sees it: every race card keeps only their
 * cars, and every result only their places. Feed the output to
 * `buildStandings` for that group's table.
 */
export function leagueView(
  cards: RaceCard[],
  results: Map<string, RaceResult>,
  members: Iterable<string>,
): { cards: RaceCard[]; results: Map<string, RaceResult> } {
  const uids = new Set(members);
  const outCards: RaceCard[] = [];
  const outResults = new Map<string, RaceResult>();
  for (const card of cards) {
    const entries = card.entries.filter((e) => uids.has(e.uid));
    if (entries.length === 0) continue;
    const ids = new Set(entries.map((e) => e.id));
    outCards.push({ ...card, entries });
    const result = results.get(card.id);
    if (result) outResults.set(card.id, { ...result, places: result.places.filter((p) => ids.has(p.entryId)) });
  }
  return { cards: outCards, results: outResults };
}

