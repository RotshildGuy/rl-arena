import { OBS_SIZE, OBS_VERSION, ACTION_LABELS } from '../games/racing/rewards';
import { PHYSICS_V2_ROUND } from './schedule';
import type { ArenaEntry } from './types';

/**
 * The house team: pre-trained cars that fill a thin grid.
 *
 * A race needs `MIN_ENTRIES` cars, and with few players the championship
 * screen said "the championship has not started" day after day, which is what
 * a dead place looks like. So from the first physics-2 round on, any grid with
 * a real car on it is topped up to `HOUSE_GRID` from this list, weakest first:
 * a newcomer's first race has somebody to beat, and the stronger house cars
 * only show up when the grid is nearly empty.
 *
 * Every client builds the race card for itself, so this list has to be the same
 * for everybody - a constant, never anything read at run time. The weights live
 * in `public/house/<id>.json` (`scripts/trainHouse.ts` writes them) and are
 * frozen onto the card like any other car's, so a replay never depends on these
 * files staying the same.
 *
 * House cars race for drivers' points like everybody else - a win against one
 * is a real win - but the house is not a team in the constructors' table.
 */
export const HOUSE_UID = 'house';
export const HOUSE_TEAM = 'קבוצת הבית';
/** The grid size the house fills to. */
export const HOUSE_GRID = 6;
/** House cars learned on physics 2, so they start racing when the championship does. */
export const HOUSE_FROM_ROUND = PHYSICS_V2_ROUND;

const HOUSE_HIDDEN = [64, 64];

function houseEntry(id: string, driver: string, tag: string, episodes: number): ArenaEntry {
  return {
    id,
    uid: HOUSE_UID,
    driver,
    team: HOUSE_TEAM,
    gameId: 'racing',
    algorithm: 'ga',
    arch: { obsSize: OBS_SIZE, hidden: HOUSE_HIDDEN, nActions: ACTION_LABELS.length },
    obsVersion: OBS_VERSION,
    tag,
    createdAt: 0,
    updatedAt: 0,
    modelId: id,
    episodes,
  };
}

/** Weakest first: the order they are called up in. */
export const HOUSE_DRIVERS: readonly ArenaEntry[] = [
  houseEntry('house-1', 'טירון', 'TIR', 40),
  houseEntry('house-2', 'מתלמד', 'MTL', 50),
  houseEntry('house-3', 'מאוזן', 'MZN', 150),
  houseEntry('house-4', 'פזיז', 'PZZ', 150),
];

export function isHouse(e: { uid: string }): boolean {
  return e.uid === HOUSE_UID;
}

/** Whether an id belongs to the house. A real entry that claims one is ignored. */
export function isHouseId(id: string): boolean {
  return HOUSE_DRIVERS.some((h) => h.id === id);
}

/**
 * The field with the house added. Nothing is added before `HOUSE_FROM_ROUND`
 * - those rounds were raced, or skipped, without it - nor to an empty grid:
 * a race of house cars alone is nobody's race.
 */
export function withHouse(field: ArenaEntry[], round: number): ArenaEntry[] {
  if (round < HOUSE_FROM_ROUND || field.length === 0) return field;
  const need = Math.max(0, HOUSE_GRID - field.length);
  return [...field, ...HOUSE_DRIVERS.slice(0, need)];
}

/** Where a house car's weights are served from. */
export function houseWeightsUrl(id: string): string {
  return `/house/${id}.json`;
}
