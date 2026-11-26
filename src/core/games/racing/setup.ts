/**
 * Car setup: a trade-off, never an upgrade (ROADMAP 6.4).
 *
 * Before training, a team picks how its car is set up. Every setup is free,
 * and none is better than the others everywhere: more wing holds the car in
 * the corners and costs it on the straights, less wing does the opposite. The
 * right choice depends on the circuits of the season, which is the point - it
 * is a decision, not something to buy.
 *
 * A model trains on its setup, the setup is saved with the model, and when the
 * car is entered it travels on the entry, so the race card freezes it together
 * with the weights. "Balanced" is the car as it always was: every factor is
 * exactly 1, so a car without a setup drives bit for bit as before.
 *
 * Setups only exist on physics version 2 and later. Version 1 ignores them.
 */
export type SetupId = 'balanced' | 'downforce' | 'lowdrag';

export interface CarSetup {
  id: SetupId;
  /** Multiplies the top speed. */
  topSpeed: number;
  /** Multiplies the engine's pull. */
  accel: number;
  /** Multiplies how much sideways force the tyres hold, gripping or sliding. */
  grip: number;
  /** Multiplies the brakes. */
  brake: number;
}

export const SETUPS: readonly CarSetup[] = [
  { id: 'balanced', topSpeed: 1, accel: 1, grip: 1, brake: 1 },
  // More wing: glued to the road in the corners, stops shorter, but the wing
  // is drag on every straight.
  { id: 'downforce', topSpeed: 0.9, accel: 0.92, grip: 1.07, brake: 1.05 },
  // Less wing: a higher top speed and a stronger pull out of the corners, and
  // tyres that let go sooner.
  { id: 'lowdrag', topSpeed: 1.12, accel: 1.07, grip: 0.95, brake: 0.97 },
];

export const DEFAULT_SETUP: SetupId = 'balanced';

const BY_ID = new Map(SETUPS.map((s) => [s.id, s]));

export function isSetupId(v: unknown): v is SetupId {
  return typeof v === 'string' && BY_ID.has(v as SetupId);
}

/** The setup for an id, and the balanced car for anything unknown or missing. */
export function setupOf(id: unknown): CarSetup {
  return (isSetupId(id) && BY_ID.get(id)) || BY_ID.get(DEFAULT_SETUP)!;
}

/**
 * What kind of circuit each one is, by the setup that is quickest on it for
 * the reference driver (`npx tsx scripts/setupCheck.ts`, which says so when
 * this table and its measurement disagree). Shown in the season preview as
 * "long straights", "lots of corners" or "mixed" - a hint for choosing a setup, not the answer:
 * a model drives differently from the reference driver.
 */
export const TRACK_CHARACTER: Readonly<Record<string, SetupId>> = {
  oval: 'lowdrag',
  kidney: 'downforce',
  technical: 'downforce',
  speedway: 'balanced',
  stadium: 'lowdrag',
  triangle: 'balanced',
  serpent: 'downforce',
  clover: 'balanced',
  coast: 'balanced',
  ring: 'lowdrag',
  harbor: 'downforce',
};
