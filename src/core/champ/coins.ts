import { buildStandings } from './points';
import { hallOfFame, seasonCards } from './seasons';
import { HOUSE_UID } from './house';
import type { RaceCard, RaceResult } from './types';

/**
 * Coins: what a team has earned, and nothing else.
 *
 * Coins buy looks, never speed (ROADMAP 6). Earning is not stored anywhere: it
 * is a pure function of race results that are already published and cannot be
 * rewritten, exactly like the championship table. Every browser works out the
 * same number for every team, and nobody can write themselves a bigger one.
 *
 * Spending is the only thing a team writes (`shop/{uid}`), and every browser
 * that paints somebody else's car checks it against this. A forged purchase
 * gets a car painted in a colour only the forger can see.
 */
export const COINS_PER_START = 5;
/** By the team's place in a finished season's constructors' table. */
export const SEASON_BONUS = [150, 100, 70, 50, 35, 25, 15, 10];

export interface Earning {
  label: string;
  coins: number;
}

export interface Wallet {
  total: number;
  breakdown: Earning[];
}

/**
 * Pass settled results only (`settledResults`), so a race on air pays nothing
 * until it has been seen.
 */
export function earnedCoins(uid: string, cards: RaceCard[], settled: Map<string, RaceResult>, now: number): Wallet {
  if (!uid || uid === HOUSE_UID) return { total: 0, breakdown: [] };
  let points = 0;
  let starts = 0;
  let finishes = 0;
  let podiums = 0;
  let wins = 0;
  let clean = 0;

  for (const card of cards) {
    const result = settled.get(card.id);
    if (!result) continue;
    const mine = new Set(card.entries.filter((e) => e.uid === uid).map((e) => e.id));
    if (mine.size === 0) continue;
    for (const p of result.places) {
      if (!mine.has(p.entryId)) continue;
      starts++;
      points += p.points;
      if (p.status === 'finished') finishes++;
      if (p.position <= 3 && p.classified) podiums++;
      if (p.position === 1 && p.classified) wins++;
    }
    for (const s of result.sessions) {
      for (const f of s.classification) {
        if (mine.has(f.entryId) && f.status === 'finished' && f.wallHits === 0) clean++;
      }
    }
  }

  const breakdown: Earning[] = [];
  if (points) breakdown.push({ label: `נקודות במרוצים (${points})`, coins: points });
  if (starts) breakdown.push({ label: `השתתפות (${starts} זינוקים)`, coins: starts * COINS_PER_START });

  // Season-end bonus, by the team's place in each finished season.
  for (const h of hallOfFame(cards, settled, now)) {
    const table = buildStandings({ cards: seasonCards(cards, h.season).filter((c) => settled.has(c.id)), results: settled });
    const team = table.teams.find((t) => t.uid === uid);
    if (!team) continue;
    const bonus = SEASON_BONUS[team.position - 1] ?? 5;
    breakdown.push({ label: `סיום עונה ${h.season} במקום ${team.position}`, coins: bonus });
  }

  // One-off achievements.
  const once: Array<[boolean, string, number]> = [
    [finishes >= 1, 'מרוץ ראשון עד הדגל', 20],
    [podiums >= 1, 'פודיום ראשון', 40],
    [wins >= 1, 'ניצחון ראשון', 75],
    [clean >= 1, 'מרוץ שלם בלי לגעת בקיר', 30],
    [starts >= 10, 'עשרה מרוצים', 50],
  ];
  for (const [got, label, coins] of once) if (got) breakdown.push({ label, coins });

  return { total: breakdown.reduce((s, e) => s + e.coins, 0), breakdown };
}
