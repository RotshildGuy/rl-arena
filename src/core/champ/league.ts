import type { RaceCard, RaceResult } from './types';

/**
 * A private league is a filter, not a second championship.
 *
 * Friends race in the same daily Grand Prix as everybody else; the league
 * table counts only their cars, with the points those cars actually scored.
 * There is no separate race to run, store or keep in step - which is what lets
 * anybody start one with a name and a link.
 *
 *   leagues/{id}   { name, owner, members: [uid...], createdAt }
 *
 * The id is the invitation: whoever has the link can join.
 */
export interface League {
  id: string;
  name: string;
  owner: string;
  members: string[];
  createdAt: number;
}

export const LEAGUE_NAME_MAX = 32;
export const LEAGUE_MAX_MEMBERS = 50;

/**
 * The season as the league sees it: every race card keeps only the members'
 * cars, and every result only their places. Feed the output to
 * `buildStandings` for the league's table.
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

/** An id that is hard to guess and easy to read out: 10 characters, no look-alikes. */
export function newLeagueId(random: () => number = Math.random): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += alphabet[Math.floor(random() * alphabet.length)];
  return s;
}
