import type { SessionPlan } from './types';

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
 * How a field is whittled down to one grid.
 *
 * Up to `GRID_SIZE` everyone races at once and the day is a single Grand Prix.
 * Above it the day becomes an elimination ladder: enough heats to fit everybody,
 * the top finishers of each going through, repeated until one grid is left.
 */
function roundShapes(n: number): RoundShape[] {
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

/** "חצי גמר" when the next round is the final, "רבע גמר" one before that. */
function roundName(roundsLeftAfterThis: number): string {
  if (roundsLeftAfterThis === 0) return 'חצי גמר';
  if (roundsLeftAfterThis === 1) return 'רבע גמר';
  return 'מוקדמות';
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
 * — they are only known once the earlier heats have run.
 */
export function planSessions(qualiOrder: string[]): SessionPlan[] {
  const shapes = roundShapes(qualiOrder.length);
  const sessions: SessionPlan[] = [];
  let slot = 0;

  shapes.forEach((shape, r) => {
    const grids = r === 0 ? snakeSeed(qualiOrder, shape.groups) : [];
    for (let g = 0; g < shape.groups; g++) {
      sessions.push({
        id: `r${r}g${g}`,
        kind: 'heat',
        name: `${roundName(shapes.length - 1 - r)} ${shape.groups > 1 ? g + 1 : ''}`.trim(),
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
    name: shapes.length ? 'גמר' : 'מרוץ',
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
