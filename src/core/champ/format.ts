import type { SessionPlan } from './types';
import { t } from '../../i18n/dict';

/** Cars the track can take at once. Four grid rows is as much as these circuits fit. */
export const GRID_SIZE = 10;
/** Minimum entrants for a race day to happen at all. */
export const MIN_ENTRIES = 2;
/** Wall-clock gap between the lights going out on consecutive sessions. */
export const SESSION_GAP_MS = 3 * 60 * 1000;
export const RACE_LAPS = 10;
/** Heats are shorter so a day with three of them plus a final stays watchable. */
export const HEAT_LAPS = 6;

interface RoundShape {
  groups: number;
  advance: number;
}

/**
 * The first round raced on the knockout format (version 2): the opener of
 * season 4. Every client and the server plan a day from its qualifying order
 * alone, so a round that already ran - or is still to run this season - must
 * keep the ladder it was raced on, or its replay would no longer reproduce
 * the published result.
 */
export const KNOCKOUT_FORMAT_ROUND = 25;

/**
 * Version 1, up to round 24: enough heats to fit everybody, the top finishers
 * of each going through, repeated until one grid is left. It sent a single car
 * through from each of 10 heats at 100 entries and called three groups
 * "semi-finals", which is what version 2 fixes.
 */
function roundShapesV1(n: number): RoundShape[] {
  const shapes: RoundShape[] = [];
  let count = n;
  while (count > GRID_SIZE) {
    const groups = Math.ceil(count / GRID_SIZE);
    const advance = Math.max(2, Math.floor(GRID_SIZE / groups));
    shapes.push({ groups, advance });
    count = groups * advance;
  }
  return shapes;
}

/** Top half of a full grid goes through in a knockout race (semis, quarters...). */
const KNOCKOUT_ADVANCE = GRID_SIZE / 2;
/** Top three go through in a heat, the round that sits between two knockout sizes. */
const HEAT_ADVANCE = 3;
/** Every session sends at least this many cars home: none is a parade where all go through. */
const MIN_ELIMINATED = 2;

/**
 * Version 2: a real knockout bracket.
 *
 * Knockout rounds come in powers of two (2 semi-finals, 4 quarter-finals,
 * 8 round-of-16 races...) with the top five of each going through, so every
 * later round is full grids of ten. A bracket of B races is used once the
 * field is over three quarters of what it holds (31-40 for quarters, 61-80
 * for the round of 16). Between two bracket sizes the field would spread too
 * thin, so it first races 3B/4 heats of seven to ten, top three through,
 * which fills the bracket below exactly with nine-car grids:
 *
 *   up to 10  one race
 *   11-20     2 semis -> final
 *   21-30     3 heats -> final
 *   31-40     4 quarters -> 2 semis -> final
 *   41-60     6 heats -> 2 semis -> final
 *   61-80     8 round-of-16 -> 4 quarters -> 2 semis -> final
 *   81-120    12 heats -> 4 quarters -> 2 semis -> final
 *   121-160   16 races -> 8 -> 4 -> 2 -> final, and so on
 *
 * And no session lets everyone through: with 11 to 13 entries the semis
 * have only five or six cars, so fewer than five go on.
 */
function roundShapesV2(n: number): RoundShape[] {
  if (n <= GRID_SIZE) return [];
  let bracket = 2;
  while (n > GRID_SIZE * bracket) bracket *= 2;

  const shapes: RoundShape[] = [];
  let count = n;
  const push = (groups: number, base: number) => {
    const smallest = Math.floor(count / groups);
    const advance = Math.max(1, Math.min(base, smallest - MIN_ELIMINATED));
    shapes.push({ groups, advance });
    count = groups * advance;
  };

  let next: number;
  if (bracket === 2 || n > (GRID_SIZE * bracket * 3) / 4) {
    push(bracket, KNOCKOUT_ADVANCE);
    next = bracket / 2;
  } else {
    push((bracket * 3) / 4, HEAT_ADVANCE);
    next = bracket / 4;
  }
  for (let groups = next; groups >= 2; groups /= 2) push(groups, KNOCKOUT_ADVANCE);
  return shapes;
}

function roundShapes(n: number, round: number): RoundShape[] {
  return round >= KNOCKOUT_FORMAT_ROUND ? roundShapesV2(n) : roundShapesV1(n);
}

/**
 * A round is named by how many races it has, not by how far it is from the
 * final: "semi-final" only when there are two of them, "quarter-final" only
 * for four. Three races are not halves of anything, so any other count is a
 * plain heat.
 */
function roundName(groups: number): string {
  const c = t().champ;
  if (groups === 2) return c.semiFinal;
  if (groups === 4) return c.quarterFinal;
  if (groups === 8) return c.roundOf16;
  return c.heats;
}

/**
 * Spread the fast cars across the heats instead of stacking them in one.
 * Serpentine seeding is what every real qualifying-into-heats format uses: pole
 * sitter to heat 1, second to heat 2, and the order reverses each pass.
 */
export function snakeSeed(order: string[], groups: number): string[][] {
  const out: string[][] = Array.from({ length: groups }, () => []);
  order.forEach((id, i) => {
    const pass = Math.floor(i / groups);
    const slot = i % groups;
    out[pass % 2 === 0 ? slot : groups - 1 - slot].push(id);
  });
  return out;
}

/**
 * The sessions of one race day. Grids for rounds after the first are left empty
 * - they are only known once the earlier heats have run. `round` is the
 * championship round, which picks the format version (`KNOCKOUT_FORMAT_ROUND`).
 */
export function planSessions(qualiOrder: string[], round: number): SessionPlan[] {
  const shapes = roundShapes(qualiOrder.length, round);
  const sessions: SessionPlan[] = [];
  let slot = 0;

  shapes.forEach((shape, r) => {
    const grids = r === 0 ? snakeSeed(qualiOrder, shape.groups) : [];
    for (let g = 0; g < shape.groups; g++) {
      sessions.push({
        id: `r${r}g${g}`,
        kind: 'heat',
        name: `${roundName(shape.groups)} ${shape.groups > 1 ? g + 1 : ''}`.trim(),
        round: r,
        grid: grids[g] ?? [],
        advance: shape.advance,
        offsetMs: slot++ * SESSION_GAP_MS,
      });
    }
  });

  sessions.push({
    id: shapes.length ? 'final' : 'race',
    kind: shapes.length ? 'final' : 'race',
    name: shapes.length ? t().champ.final : t().champ.race,
    round: shapes.length,
    grid: shapes.length ? [] : qualiOrder,
    advance: 0,
    offsetMs: slot * SESSION_GAP_MS,
  });

  return sessions;
}

export function lapsFor(session: SessionPlan): number {
  return session.kind === 'heat' ? HEAT_LAPS : RACE_LAPS;
}

/** Total wall-clock length of a race day, for the calendar. */
export function dayDurationMs(sessions: SessionPlan[]): number {
  return sessions.length ? sessions[sessions.length - 1].offsetMs + SESSION_GAP_MS : 0;
}
