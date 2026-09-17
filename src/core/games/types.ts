/** Contract every game implements. Keeping it multi-agent from the start is what
 *  lets one trained model race against others (and against the player). */

/**
 * One reward channel, exposed to the user as a ten-notch slider rather than a
 * number. Nobody outside the field has any intuition for "-0.005 per step", but
 * everybody has an intuition for "1 = careful, 10 = reckless". The raw values
 * live in `levels` and never reach the screen.
 */
export interface RewardChannelDef {
  key: string;
  label: string;
  hint: string;
  /** Exactly REWARD_LEVELS values, ordered from notch 1 to notch 10. */
  levels: number[];
  /** Which notch a fresh model starts on, 1-based. */
  defaultLevel: number;
  /** The character of each end of the slider, in one or two words. */
  lowLabel: string;
  highLabel: string;
}

/** Every channel has the same number of notches, so the sliders read as a set. */
export const REWARD_LEVELS = 10;

export type RewardConfig = Record<string, number>;

export interface EnvSpec {
  id: string;
  name: string;
  /** Fixed for all maps and agent counts — a saved model depends on it. */
  obsSize: number;
  /** Bumped whenever the observation layout changes, invalidating old models. */
  obsVersion: number;
  /** Human-readable labels, one per discrete action. */
  actions: string[];
  /** What score() measures, e.g. "הקפות". Shown on the training dashboard. */
  scoreLabel: string;
  rewardChannels: RewardChannelDef[];
}

export interface StepResult {
  /** Shaped reward for each agent this step. */
  rewards: Float32Array;
  /** 1 once an agent is finished; it stops acting but the episode may continue. */
  done: Uint8Array;
  allDone: boolean;
}

export interface Env<Snap = unknown> {
  readonly spec: EnvSpec;
  readonly nAgents: number;
  /** Live reward weights — swapped mid-training without touching the model. */
  rewards: RewardConfig;
  /**
   * Give one agent its own reward table, overriding `rewards` for that seat.
   *
   * This is what lets several models train in the same episode without sharing a
   * personality: each car is scored by the weights of whoever is driving it.
   * Optional, because a game with a single global scoring rule need not offer it.
   */
  setAgentRewards?(agent: number, rewards: RewardConfig): void;
  reset(seed: number): void;
  /** Writes the observation for `agent` into `out` and returns it. */
  observe(agent: number, out: Float32Array): Float32Array;
  step(actions: Int32Array): StepResult;
  /** True once this agent has finished or been eliminated for the episode. */
  isAgentDone(agent: number): boolean;
  /** Game-native progress measure for the dashboard — laps, goals, distance. */
  score(agent: number): number;
  /** Structured-clone-safe view for rendering on the main thread. */
  snapshot(): Snap;
  /**
   * Lap and total times. Optional because the contract has to hold for a game
   * without laps too; the training dashboard hides the timing panel when a game
   * does not answer.
   */
  raceStats?(agent: number): { bestLapMs: number | null; totalMs: number | null };
}

export function defaultRewards(spec: EnvSpec): RewardConfig {
  const out: RewardConfig = {};
  for (const c of spec.rewardChannels) out[c.key] = channelDefault(c);
  return out;
}

/** The raw weight a channel starts on. */
export function channelDefault(c: RewardChannelDef): number {
  return c.levels[c.defaultLevel - 1];
}

/** The raw weight at a notch, clamped so a bad index can never produce NaN. */
export function levelValue(c: RewardChannelDef, level: number): number {
  const i = Math.min(c.levels.length, Math.max(1, Math.round(level))) - 1;
  return c.levels[i];
}

/**
 * The notch a stored weight sits on. Nearest match rather than exact, so a model
 * saved before the sliders existed (or imported from a file) still opens on a
 * sensible position instead of snapping to 1.
 */
export function levelOf(c: RewardChannelDef, v: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < c.levels.length; i++) {
    const d = Math.abs(c.levels[i] - v);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best + 1;
}
